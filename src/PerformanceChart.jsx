import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInteger } from "./gscImport";

export default function PerformanceChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#e6ebf2" strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: "#77839a", fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#77839a", fontSize: 12 }} />
        <Tooltip
          formatter={(value, name) => [formatInteger(value), name === "impressions" ? "Impressioni" : "Clic"]}
          contentStyle={{ border: "1px solid #dbe2ec", borderRadius: 8, boxShadow: "0 8px 24px rgba(3,28,61,.08)" }}
        />
        <Line type="monotone" dataKey="impressions" stroke="#17a85f" strokeWidth={3} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="clicks" stroke="#2477ee" strokeWidth={3} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
