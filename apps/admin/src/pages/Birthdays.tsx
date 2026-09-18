import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Cake, Check, MessageCircle, Phone } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  last_birthday_greeted_at: string | null;
}

type Filter = "upcoming30" | "thisMonth" | "all" | "notGreeted";
type SortKey = "next" | "name";

// Days until the next occurrence of `birthday` (month/day only — the stored
// year is just whatever year the customer was born, not meaningful here).
// 0 = today, 365ish = just had it.
function daysUntilNextBirthday(birthday: string, today: Date): number {
  const b = new Date(birthday);
  const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  next.setHours(0, 0, 0, 0);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (next < t) next.setFullYear(next.getFullYear() + 1);
  return Math.round((next.getTime() - t.getTime()) / 86400000);
}

function turningAge(birthday: string, today: Date): number {
  const b = new Date(birthday);
  const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const year = next < t ? today.getFullYear() + 1 : today.getFullYear();
  return year - b.getFullYear();
}

// The most recent occurrence of `birthday` (month/day) on or before today —
// i.e. this year's if it's already passed, last year's if it hasn't yet.
function mostRecentBirthdayOccurrence(birthday: string, today: Date): Date {
  const b = new Date(birthday);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const occ = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  if (occ > t) occ.setFullYear(occ.getFullYear() - 1);
  return occ;
}

// Greeted for the current cycle if the last "marked followed up" timestamp
// is on or after the most recent birthday occurrence — so it automatically
// resets the moment a new birthday (this year's) comes around.
function greetedThisCycle(c: Customer, today: Date): boolean {
  if (!c.last_birthday_greeted_at || !c.birthday) return false;
  return new Date(c.last_birthday_greeted_at) >= mostRecentBirthdayOccurrence(c.birthday, today);
}

export function Birthdays() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<Filter>("upcoming30");
  const [sortKey, setSortKey] = useState<SortKey>("next");
  const [search, setSearch] = useState("");
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("birthdays-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, email, birthday, last_birthday_greeted_at")
      .not("birthday", "is", null)
      .order("name");
    setCustomers((data as Customer[]) ?? []);
  }

  async function markGreeted(c: Customer) {
    await supabase.from("customers").update({ last_birthday_greeted_at: new Date().toISOString() }).eq("id", c.id);
    load();
  }

  function waLink(c: Customer) {
    const digits = c.phone.replace(/\D/g, "");
    const days = daysUntilNextBirthday(c.birthday!, today);
    const msg =
      days === 0
        ? `Happy Birthday ${c.name}! 🎉 Wishing you a wonderful day from all of us at Sai Communication.`
        : `Hi ${c.name}, your birthday is coming up on ${formatDate(c.birthday!)} — we'd love to wish you well and let you know about any birthday offers we have running!`;
    return `https://wa.me/91${digits}?text=${encodeURIComponent(msg)}`;
  }

  const rows = useMemo(() => {
    return customers
      .filter((c) => c.birthday)
      .filter((c) => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone.includes(search)) return false;
        const days = daysUntilNextBirthday(c.birthday!, today);
        if (filter === "upcoming30") return days <= 30;
        if (filter === "thisMonth") return new Date(c.birthday!).getMonth() === today.getMonth();
        if (filter === "notGreeted") return days <= 30 && !greetedThisCycle(c, today);
        return true;
      })
      .sort((a, b) => {
        if (sortKey === "name") return a.name.localeCompare(b.name);
        return daysUntilNextBirthday(a.birthday!, today) - daysUntilNextBirthday(b.birthday!, today);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, filter, sortKey, search]);

  const dueSoonCount = customers.filter((c) => c.birthday && daysUntilNextBirthday(c.birthday, today) <= 7).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">
          Birthday Reminders{" "}
          {dueSoonCount > 0 && <span className="pill-warning ml-2 align-middle">{dueSoonCount} within 7 days</span>}
        </h1>
        <ExportExcelButton
          rows={rows.map((c) => ({
            Name: c.name,
            Phone: c.phone,
            Email: c.email,
            Birthday: c.birthday,
            "Turning Age": turningAge(c.birthday!, today),
            "Days Until": daysUntilNextBirthday(c.birthday!, today),
            "Greeted This Year": greetedThisCycle(c, today) ? "Yes" : "No",
          }))}
          fileName="birthday-reminders"
        />
      </div>
      <p className="text-sm text-gray-500">
        Every customer with a date of birth on file (captured at checkout online or at sale in-store), sorted by how
        soon their next birthday is. Mark one as followed up once you've reached out — it resets automatically next
        year.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="upcoming30">Next 30 days</option>
          <option value="thisMonth">This calendar month</option>
          <option value="notGreeted">Due soon &amp; not yet greeted</option>
          <option value="all">All customers with a DOB</option>
        </select>
        <select className="input w-auto" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="next">Sort: Soonest birthday</option>
          <option value="name">Sort: Name (A-Z)</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Birthday</th>
              <th>Turning</th>
              <th>Next Birthday</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const days = daysUntilNextBirthday(c.birthday!, today);
              const greeted = greetedThisCycle(c, today);
              return (
                <tr key={c.id}>
                  <td className="font-medium text-gray-800">{c.name}</td>
                  <td className="text-gray-500">{c.phone}</td>
                  <td className="text-gray-500">{formatDate(c.birthday!)}</td>
                  <td className="text-gray-500">{turningAge(c.birthday!, today)}</td>
                  <td>
                    {days === 0 ? (
                      <span className="pill-danger flex w-fit items-center gap-1">
                        <Cake size={12} /> Today!
                      </span>
                    ) : days <= 7 ? (
                      <span className="pill-warning">In {days} day{days === 1 ? "" : "s"}</span>
                    ) : (
                      <span className="text-gray-500">In {days} days</span>
                    )}
                  </td>
                  <td>
                    {greeted ? (
                      <span className="pill-success">Greeted</span>
                    ) : (
                      <span className="pill-neutral">Not yet</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={waLink(c)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary !px-2 !py-1 text-xs"
                        title="Send birthday wishes via WhatsApp"
                      >
                        <MessageCircle size={13} />
                      </a>
                      <a href={`tel:${c.phone}`} className="btn-ghost !px-2 !py-1 text-xs" title="Call">
                        <Phone size={13} />
                      </a>
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs"
                        onClick={() => markGreeted(c)}
                        title="Mark as followed up for this year"
                        disabled={greeted}
                      >
                        <Check size={13} className={greeted ? "text-brand-success" : ""} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No customers match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
