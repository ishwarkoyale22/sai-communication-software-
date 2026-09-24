// Zone-less database timestamps are UTC — see parseDbTimestamp in @sai/shared.
import { parseDbTimestamp } from "@sai/shared";

export const dbTime = (value: string): Date => parseDbTimestamp(value);
