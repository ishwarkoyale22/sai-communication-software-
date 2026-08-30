import { useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";

export function Login() {
  const { loginWithPin } = useStaffAuth();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [justIn, setJustIn] = useState(false);

  function pressDigit(d: string) {
    if (pin.length < 4) setPin(pin + d);
  }

  async function submit() {
    setLoading(true);
    setError(null);
    const { error } = await loginWithPin(phone, pin);
    setLoading(false);
    if (error) {
      setError(error);
      setPin("");
    } else {
      setJustIn(true);
    }
  }

  if (justIn) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-page px-6 text-center">
        <div className="text-4xl">✅</div>
        <p className="mt-3 text-lg font-semibold text-gray-800">You're clocked in!</p>
        <p className="text-sm text-gray-500">{new Date().toLocaleTimeString("en-IN")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-page px-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-800">Sai Communication</h1>
      <p className="mb-6 text-sm text-gray-500">Staff Portal</p>

      <input
        type="tel"
        placeholder="Phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="input mb-4 w-64 text-center text-base"
      />

      <div className="mb-4 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-12 w-10 items-center justify-center rounded-md border border-gray-300 text-xl">
            {pin[i] ? "•" : ""}
          </div>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-brand-danger">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => pressDigit(d)}
            className="h-14 w-14 rounded-full border border-gray-300 text-lg font-medium active:bg-gray-100"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setPin(pin.slice(0, -1))}
          className="h-14 w-14 rounded-full text-sm text-gray-500 active:bg-gray-100"
        >
          ⌫
        </button>
        <button
          onClick={() => pressDigit("0")}
          className="h-14 w-14 rounded-full border border-gray-300 text-lg font-medium active:bg-gray-100"
        >
          0
        </button>
        <div />
      </div>

      <button
        disabled={pin.length !== 4 || !phone || loading}
        onClick={submit}
        className="btn-primary mt-6 w-64 py-2.5"
      >
        {loading ? "Signing in..." : "Clock In"}
      </button>
    </div>
  );
}
