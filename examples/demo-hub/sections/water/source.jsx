import { useEffect, useState } from "react";

// A React chat artifact styled with Tailwind and saved with the async window.storage API.

const GOAL = 8;
const dayKey = (date = new Date()) => date.toLocaleDateString("en-CA");

export default function WaterTracker() {
  const [days, setDays] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await window.storage.get("water-v1");
        setDays(JSON.parse(saved.value));
      } catch {
        // first run: nothing saved yet
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage.set("water-v1", JSON.stringify(days)).catch(() => {});
  }, [days, loaded]);

  const today = dayKey();
  const glasses = days[today] ?? 0;
  const change = (delta) =>
    setDays((current) => ({ ...current, [today]: Math.max(0, (current[today] ?? 0) + delta) }));

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    return date;
  });

  return (
    <div className="min-h-screen bg-sky-50 px-4 py-10 text-slate-800">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Water</h1>
        <p className="mb-6 text-slate-500">
          {glasses} of {GOAL} glasses today
        </p>

        <div className="mb-6 grid grid-cols-4 gap-3">
          {Array.from({ length: GOAL }, (_, i) => (
            <div
              key={i}
              className={`h-16 rounded-2xl border-2 transition-colors ${
                i < glasses ? "border-sky-400 bg-sky-400" : "border-sky-200 bg-white"
              }`}
            />
          ))}
        </div>

        <div className="mb-10 flex gap-3">
          <button
            onClick={() => change(-1)}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-3 font-medium hover:bg-slate-50"
          >
            − Glass
          </button>
          <button
            onClick={() => change(1)}
            className="flex-1 rounded-xl bg-sky-500 py-3 font-medium text-white hover:bg-sky-600"
          >
            + Glass
          </button>
        </div>

        <div className="flex h-28 items-end justify-between gap-2">
          {week.map((date) => {
            const count = days[dayKey(date)] ?? 0;
            return (
              <div key={dayKey(date)} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-md bg-sky-300"
                  style={{ height: `${Math.max(4, Math.min(1, count / GOAL) * 88)}px` }}
                  title={`${count} glasses`}
                />
                <span className="text-xs text-slate-400">
                  {date.toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
