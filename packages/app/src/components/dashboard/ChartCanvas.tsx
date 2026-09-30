import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartCard as ChartCardDef } from '@digitaplatform/shared';
import { NEUTRAL } from '@digitaplatform/theme';

/**
 * The ONLY module that imports `recharts`. Loaded lazily by ChartCard via
 * React.lazy so the (large) charting bundle is code-split off the dashboard.
 * RESOLVED theme hex colors are passed in (recharts SVG fill/stroke does NOT
 * inherit CSS vars) — never `var(--…)` strings.
 */

export interface ChartCanvasProps {
  card: ChartCardDef;
  rows: Array<Record<string, unknown>>;
  /** Resolved palette (hex), one per series, cycled if there are more series. */
  colors: string[];
  /** Resolved grid/axis line color (hex) — SVG stroke does not inherit CSS vars. */
  gridColor: string;
  /** Narrow widths drop the legend/axis chrome. */
  compact: boolean;
  /** The name a y field's series shows in the legend and the tooltip. */
  seriesLabel: (key: string) => string;
}

function colorAt(colors: string[], i: number): string {
  // Same neutral the theme uses for muted strokes — token-sourced, not an
  // off-system gray (only reachable if `colors` is empty, which it never is).
  return colors[i % colors.length] ?? NEUTRAL[400]!;
}

export default function ChartCanvas({ card, rows, colors, gridColor, compact, seriesLabel }: ChartCanvasProps) {
  const { chart_type, x_field, y_fields, stacked } = card;

  // Pie / donut: single series over the first y_field, sliced by x_field.
  if (chart_type === 'pie' || chart_type === 'donut') {
    const valueKey = y_fields[0]!;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={x_field}
            innerRadius={chart_type === 'donut' ? '55%' : 0}
            outerRadius="80%"
            isAnimationActive={false}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={colorAt(colors, i)} />
            ))}
          </Pie>
          <Tooltip />
          {!compact && <Legend />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // recharts 2 looks for its grid, axes, tooltip and legend among the chart's children with
  // react-is 18, which does not know a React 19 fragment and skips all it holds. A keyed
  // array reaches recharts as plain children.
  const axes = [
    <CartesianGrid key="grid" strokeDasharray="3 3" stroke={gridColor} />,
    <XAxis key="x" dataKey={x_field} hide={compact} tick={{ fontSize: 11 }} />,
    <YAxis key="y" hide={compact} tick={{ fontSize: 11 }} width={40} />,
    <Tooltip key="tooltip" />,
    !compact && <Legend key="legend" />,
  ];

  if (chart_type === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}>
          {axes}
          {y_fields.map((y, i) => (
            <Line
              key={y}
              type="monotone"
              dataKey={y}
              name={seriesLabel(y)}
              stroke={colorAt(colors, i)}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chart_type === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
          {axes}
          {y_fields.map((y, i) => (
            <Area
              key={y}
              type="monotone"
              dataKey={y}
              name={seriesLabel(y)}
              stroke={colorAt(colors, i)}
              fill={colorAt(colors, i)}
              fillOpacity={0.2}
              stackId={stacked ? 'stack' : undefined}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // bar (default)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows}>
        {axes}
        {y_fields.map((y, i) => (
          <Bar
            key={y}
            dataKey={y}
            name={seriesLabel(y)}
            fill={colorAt(colors, i)}
            stackId={stacked ? 'stack' : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
