import { supabase } from "./supabase";
import { lineAmounts, type PurchaseLine } from "@sai/shared";

export interface InventorySyncResult {
  created: string[];
  restocked: string[];
  problems: string[];
}

interface Existing {
  id: string;
  name: string;
  model: string;
  stock: number;
  is_serialized: boolean;
}

/**
 * Puts the lines of a saved supplier bill into inventory: an item that already exists (same name or model) gets
 * its stock raised (or the bill's serials added to it), anything new is created with the bill's price as its cost.
 * A new item's sale price starts at the cost incl. GST as a placeholder — it is meant to be edited afterwards.
 * Never throws: a line that cannot be added is reported in `problems` and the rest carry on.
 */
export async function addPurchaseToInventory(lines: PurchaseLine[]): Promise<InventorySyncResult> {
  const out: InventorySyncResult = { created: [], restocked: [], problems: [] };
  const { data } = await supabase.from("inventory").select("id, name, model, stock, is_serialized");
  const existing = ((data as Existing[]) ?? []).slice();

  for (const l of lines) {
    const name = l.name.trim();
    if (!name) continue;
    const qty = Math.max(0, Math.floor(Number(l.quantity) || 0));
    const serials = l.serials.map((s) => s.trim()).filter(Boolean);
    const key = name.toLowerCase();
    const match = existing.find((i) => i.name.trim().toLowerCase() === key || i.model.trim().toLowerCase() === key);

    try {
      if (match) {
        if (match.is_serialized) {
          if (serials.length === 0) {
            out.problems.push(`${name}: it tracks IMEI/serials — add the serial numbers to this line (or via Manage Serials).`);
            continue;
          }
          const { error } = await supabase.from("inventory_units").insert(serials.map((serial_no) => ({ inventory_id: match.id, serial_no })));
          if (error) throw error;
          out.restocked.push(`${name} (+${serials.length})`);
        } else {
          if (qty < 1) continue;
          const { error } = await supabase.from("inventory").update({ stock: match.stock + qty }).eq("id", match.id);
          if (error) throw error;
          match.stock += qty;
          out.restocked.push(`${name} (+${qty})`);
        }
        continue;
      }

      const serialized = serials.length > 0;
      const cost = Number(l.unit_price) || 0;
      const { data: ins, error } = await supabase
        .from("inventory")
        .insert({
          name,
          model: name,
          category: serialized ? "Smartphones" : "Accessories",
          product_type: "new",
          price: lineAmounts({ quantity: 1, unit_price: cost, gst_rate: l.gst_rate }).total,
          cost_price: cost || null,
          stock: serialized ? 0 : qty,
          warranty_months: 0,
          is_featured: false,
          images: [],
          is_active: true,
          is_serialized: serialized,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (serialized) {
        const { error: uErr } = await supabase.from("inventory_units").insert(serials.map((serial_no) => ({ inventory_id: ins.id, serial_no })));
        if (uErr) throw uErr;
      }
      existing.push({ id: ins.id, name, model: name, stock: serialized ? 0 : qty, is_serialized: serialized });
      out.created.push(serialized ? `${name} (${serials.length})` : `${name} (${qty})`);
    } catch (e: any) {
      out.problems.push(`${name}: ${e?.message || "could not be added"}`);
    }
  }
  return out;
}

export function describeSync(r: InventorySyncResult): string {
  const parts: string[] = [];
  if (r.created.length) parts.push(`New in inventory: ${r.created.join(", ")}.`);
  if (r.restocked.length) parts.push(`Stock added: ${r.restocked.join(", ")}.`);
  if (r.problems.length) parts.push(`Needs attention: ${r.problems.join(" · ")}`);
  return parts.join(" ") || "No items were added to inventory.";
}
