import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import type { AggregatedData } from '../utils/aggregations'

const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#FFC658', '#FF6B6B', '#4ECDC4', '#45B7D1',
  '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
]

const LOCATION_COLORS = [
  '#FF8042', '#FFBB28', '#00C49F', '#0088FE', '#8884D8',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD',
]

const CARDHOLDER_COLORS = [
  '#8884D8', '#82CA9D', '#FFC658', '#FF6B6B', '#0088FE',
  '#00C49F', '#FFBB28', '#FF8042', '#4ECDC4', '#45B7D1',
]

const LABEL_COLORS = [
  '#6366F1', '#EC4899', '#14B8A6', '#F59E0B', '#8B5CF6',
  '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#A855F7',
]

interface ChartProps {
  data: AggregatedData[]
  title: string
  onSelect?: (value: string) => void
  selectedValue?: string
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { count: number } }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">{label || payload[0].name}</p>
        <p className="tooltip-value">{formatCurrency(payload[0].value)}</p>
        <p className="tooltip-count">{payload[0].payload.count} transacoes</p>
      </div>
    )
  }
  return null
}

interface PieLabelProps {
  name?: string
  percent?: number
}

const renderPieLabel = ({ name, percent }: PieLabelProps) => {
  if (!name || !percent || percent <= 0.05) return ''
  const displayName = name.length > 12 ? name.slice(0, 12) + '...' : name
  return `${displayName} (${(percent * 100).toFixed(0)}%)`
}

export function ExpensesByDayChart({ data, title }: ChartProps) {
  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={(v) => formatCurrency(v)}
            domain={[0, 'auto']}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#0088FE"
            strokeWidth={2}
            dot={{ fill: '#0088FE', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ExpensesByCategoryChart({ data, title, onSelect, selectedValue }: ChartProps) {
  const topData = data.slice(0, 10)

  const handleClick = (data: { name: string }) => {
    if (onSelect && data?.name) {
      onSelect(selectedValue === data.name ? '' : data.name)
    }
  }

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={topData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderPieLabel}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
            nameKey="name"
            onClick={handleClick}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {topData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
                opacity={selectedValue && selectedValue !== entry.name ? 0.4 : 1}
                stroke={selectedValue === entry.name ? '#000' : 'none'}
                strokeWidth={selectedValue === entry.name ? 2 : 0}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

interface BusinessChartProps extends ChartProps {
  drillDownData?: AggregatedData[]
  onDrillDown?: (business: string) => void
  drilledBusiness?: string
}

export function ExpensesByBusinessChart({
  data,
  title,
  drillDownData,
  onDrillDown,
  drilledBusiness
}: BusinessChartProps) {
  const isDrilledDown = !!drilledBusiness && !!drillDownData
  const displayData = isDrilledDown ? drillDownData.slice(0, 25) : data.slice(0, 25)
  const chartTitle = isDrilledDown ? `${drilledBusiness} - Details` : title

  const handleBarClick = (barData: AggregatedData) => {
    if (!barData?.name) return

    // When drilled down, clicking a description does nothing
    // (there's no further categorization available)
    if (isDrilledDown) return

    // When at top level, drill down into the business
    if (onDrillDown) {
      onDrillDown(barData.name)
    }
  }

  const handleBack = () => {
    if (onDrillDown) {
      onDrillDown('')
    }
  }

  return (
    <div className="chart-container">
      <div className="chart-header">
        {isDrilledDown && (
          <button type="button" className="back-button" onClick={handleBack}>
            ← Back to Businesses
          </button>
        )}
        <h3>{chartTitle}</h3>
      </div>
      <ResponsiveContainer width="100%" height={600}>
        <BarChart
          data={displayData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            width={90}
            tickFormatter={(v: string) => v.length > 15 ? v.slice(0, 15) + '...' : v}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="value"
            fill={isDrilledDown ? '#8884D8' : '#00C49F'}
            style={{ cursor: isDrilledDown ? 'default' : 'pointer' }}
            onClick={(barData) => handleBarClick(barData as unknown as AggregatedData)}
          >
            {displayData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={isDrilledDown ? '#8884D8' : '#00C49F'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ExpensesByLocationChart({ data, title, onSelect, selectedValue }: ChartProps) {
  const filteredData = data
    .filter(d => d.name && d.name !== 'Sem localizacao')
    .slice(0, 10)

  if (filteredData.length === 0) {
    return (
      <div className="chart-container">
        <h3>{title}</h3>
        <p className="no-data">Sem dados de localizacao disponiveis</p>
      </div>
    )
  }

  const handleClick = (data: { name: string }) => {
    if (onSelect && data?.name) {
      onSelect(selectedValue === data.name ? '' : data.name)
    }
  }

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={filteredData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderPieLabel}
            outerRadius={100}
            fill="#FF8042"
            dataKey="value"
            nameKey="name"
            onClick={handleClick}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {filteredData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={LOCATION_COLORS[index % LOCATION_COLORS.length]}
                opacity={selectedValue && selectedValue !== entry.name ? 0.4 : 1}
                stroke={selectedValue === entry.name ? '#000' : 'none'}
                strokeWidth={selectedValue === entry.name ? 2 : 0}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ExpensesByLabelChart({ data, title, onSelect, selectedValue }: ChartProps) {
  const topData = data.slice(0, 10)

  const handleClick = (data: { name: string }) => {
    if (onSelect && data?.name) {
      onSelect(selectedValue === data.name ? '' : data.name)
    }
  }

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={topData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderPieLabel}
            outerRadius={100}
            fill="#6366F1"
            dataKey="value"
            nameKey="name"
            onClick={handleClick}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {topData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={LABEL_COLORS[index % LABEL_COLORS.length]}
                opacity={selectedValue && selectedValue !== entry.name ? 0.4 : 1}
                stroke={selectedValue === entry.name ? '#000' : 'none'}
                strokeWidth={selectedValue === entry.name ? 2 : 0}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ExpensesByCardholderChart({ data, title, onSelect, selectedValue }: ChartProps) {
  const handleBarClick = (barData: { name: string }) => {
    if (onSelect && barData?.name) {
      onSelect(selectedValue === barData.name ? '' : barData.name)
    }
  }

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            tick={(props) => {
              const { x, y, payload } = props
              return (
                <g transform={`translate(${x},${y})`}>
                  <text
                    x={0}
                    y={0}
                    dy={10}
                    textAnchor="end"
                    fill="#666"
                    fontSize={10}
                    transform="rotate(-30)"
                  >
                    {payload.value}
                  </text>
                </g>
              )
            }}
            height={60}
            interval={0}
          />
          <YAxis tickFormatter={(v) => formatCurrency(v)} />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="value"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onClick={(barData) => handleBarClick(barData as unknown as { name: string })}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CARDHOLDER_COLORS[index % CARDHOLDER_COLORS.length]}
                opacity={selectedValue && selectedValue !== entry.name ? 0.4 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LabelExpensesTable({ data, title, onSelect, selectedValue }: ChartProps) {
  if (data.length === 0) {
    return (
      <div className="chart-container">
        <h3>{title}</h3>
        <p className="no-data">No labels yet</p>
      </div>
    )
  }

  const sorted = [...data].sort((a, b) => b.value - a.value)

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <div className="label-table-wrapper">
        <table className="label-table">
          <thead>
            <tr>
              <th>Label</th>
              <th className="num">Total</th>
              <th className="num">Count</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              const selected = selectedValue === row.name
              return (
                <tr
                  key={row.name}
                  className={selected ? 'selected' : ''}
                  onClick={() => onSelect?.(selected ? '' : row.name)}
                >
                  <td>{row.name}</td>
                  <td className="num">{formatCurrency(row.value)}</td>
                  <td className="num">{row.count}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
