'use client'

import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

interface ActivityData {
  activity_groups: {
    Energy: any[]
    'Business Travel': any[]
    'Employee Commuting': any[]
    'Other Emissions': any[]
  }
  activity_totals: {
    Energy: number
    'Business Travel': number
    'Employee Commuting': number
    'Other Emissions': number
  }
  all_categories: any[]
}

interface EmissionsByActivityProps {
  activityData: ActivityData
  reportingPeriod: string
  total: number
}

const ACTIVITY_COLORS = {
  'Energy': '#4472C4',
  'Business Travel': '#ED7D31',
  'Employee Commuting': '#A5A5A5',
  'Other Emissions': '#70AD47',
}

export default function EmissionsByActivity({ activityData, reportingPeriod, total }: EmissionsByActivityProps) {
  // Prepare donut chart data
  const donutData = Object.entries(activityData.activity_totals)
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({
      name,
      value,
      percentage: ((value / total) * 100).toFixed(1)
    }))

  // Prepare bar chart data - sort by emissions descending
  const barData = activityData.all_categories
    .map(cat => ({
      name: cat.report_label || cat.category,
      value: cat.emissions,
      scope: cat.scope
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15) // Top 15 activities

  const renderCustomLabel = (entry: any) => {
    return `${entry.name}\n${entry.value.toFixed(1)}\n${entry.percentage}%`
  }

  // Group categories for the detailed table
  const groupedCategories = {
    'Energy': activityData.activity_groups['Energy'],
    'Business Travel': activityData.activity_groups['Business Travel'],
    'Employee Commuting': activityData.activity_groups['Employee Commuting'],
    'Other Emissions': activityData.activity_groups['Other Emissions']
  }

  return (
    <div className="space-y-6">
      {/* Donut Chart */}
      <div className="flex flex-col items-center">
        <h3 className="font-semibold text-center mb-4">
          Emissions by Activity (tCO₂e)
        </h3>
        <div className="flex items-center justify-center gap-8">
          <div style={{ width: '400px', height: '350px', position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={100}
                  outerRadius={130}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderCustomLabel}
                  labelLine={true}
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={ACTIVITY_COLORS[entry.name as keyof typeof ACTIVITY_COLORS]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* Centered Total */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none'
            }}>
              <div className="text-5xl font-bold" style={{ color: '#DC143C' }}>
                {total.toFixed(1)}
              </div>
              <div className="text-sm" style={{ color: '#DC143C' }}>
                tCO₂e
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-col gap-2">
            {donutData.map((entry, index) => (
              <div key={index} className="flex items-center gap-2">
                <div 
                  style={{ 
                    width: '16px', 
                    height: '16px', 
                    backgroundColor: ACTIVITY_COLORS[entry.name as keyof typeof ACTIVITY_COLORS] 
                  }}
                />
                <span className="text-sm">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-sm text-muted-foreground mt-2">{reportingPeriod}</div>
      </div>

      {/* Bar Chart */}
      <div className="mt-8">
        <h3 className="font-semibold text-center mb-4">Emissions by Activity</h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={barData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 200, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" label={{ value: 'tCO₂e', position: 'insideBottom', offset: -5 }} />
            <YAxis type="category" dataKey="name" width={190} style={{ fontSize: '12px' }} />
            <Tooltip />
            <Bar dataKey="value" fill="#4472C4" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed Data Table - GHG Protocol Format */}
      <div className="mt-8">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-[#A8D08D] text-white">
                <th className="border border-gray-300 p-3 text-left font-semibold" colSpan={2}>
                  Data Details<br />
                  Emission Type
                </th>
                <th className="border border-gray-300 p-3 text-center font-semibold">
                  Scope
                </th>
                <th className="border border-gray-300 p-3 text-center font-semibold" colSpan={3}>
                  {reportingPeriod}<br />
                  tCO₂e
                </th>
                <th className="border border-gray-300 p-3 text-left font-semibold">
                  Data Source
                </th>
                <th className="border border-gray-300 p-3 text-left font-semibold">
                  Data Confidence
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Scope 1 */}
              <tr className="bg-[#E2EFD9] font-bold">
                <td className="border border-gray-300 p-3" colSpan={8}>Scope 1 - Direct Emissions</td>
              </tr>
              {activityData.all_categories
                .filter(cat => cat.scope === 'Scope 1')
                .map((item, idx) => (
                  <tr key={`s1-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 p-3" colSpan={2}>{item.report_label || item.category}</td>
                    <td className="border border-gray-300 p-3 text-center">1</td>
                    <td className="border border-gray-300 p-3 text-right" colSpan={3}>{item.emissions.toFixed(1)}</td>
                    <td className="border border-gray-300 p-3">{item.uom ? `${item.uom} Data` : 'Calculated'}</td>
                    <td className="border border-gray-300 p-3">{item.qty > 0 ? 'High' : 'Medium'}</td>
                  </tr>
                ))}
              {activityData.all_categories.filter(cat => cat.scope === 'Scope 1').length === 0 && (
                <tr className="bg-white">
                  <td className="border border-gray-300 p-3 text-muted-foreground italic" colSpan={2}>No Scope 1 emissions</td>
                  <td className="border border-gray-300 p-3 text-center">1</td>
                  <td className="border border-gray-300 p-3 text-right" colSpan={3}>0.0</td>
                  <td className="border border-gray-300 p-3">-</td>
                  <td className="border border-gray-300 p-3">-</td>
                </tr>
              )}
              <tr className="bg-[#E2EFD9] font-semibold">
                <td className="border border-gray-300 p-3" colSpan={3}></td>
                <td className="border border-gray-300 p-3 text-right" colSpan={3}>
                  {activityData.all_categories.filter(cat => cat.scope === 'Scope 1').reduce((sum, cat) => sum + cat.emissions, 0).toFixed(1)}
                </td>
                <td className="border border-gray-300 p-3" colSpan={2}></td>
              </tr>

              {/* Scope 2 */}
              <tr className="bg-[#E2EFD9] font-bold">
                <td className="border border-gray-300 p-3" colSpan={8}>Scope 2 - Indirect Emissions from Energy</td>
              </tr>
              {activityData.all_categories
                .filter(cat => cat.scope === 'Scope 2')
                .map((item, idx) => (
                  <tr key={`s2-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 p-3" colSpan={2}>{item.report_label || item.category}</td>
                    <td className="border border-gray-300 p-3 text-center">2</td>
                    <td className="border border-gray-300 p-3 text-right" colSpan={3}>{item.emissions.toFixed(1)}</td>
                    <td className="border border-gray-300 p-3">{item.uom ? `${item.uom} Data` : 'Calculated'}</td>
                    <td className="border border-gray-300 p-3">{item.qty > 0 ? 'High' : 'Medium'}</td>
                  </tr>
                ))}
              {activityData.all_categories.filter(cat => cat.scope === 'Scope 2').length === 0 && (
                <tr className="bg-white">
                  <td className="border border-gray-300 p-3 text-muted-foreground italic" colSpan={2}>No Scope 2 emissions</td>
                  <td className="border border-gray-300 p-3 text-center">2</td>
                  <td className="border border-gray-300 p-3 text-right" colSpan={3}>0.0</td>
                  <td className="border border-gray-300 p-3">-</td>
                  <td className="border border-gray-300 p-3">-</td>
                </tr>
              )}
              <tr className="bg-[#E2EFD9] font-semibold">
                <td className="border border-gray-300 p-3" colSpan={3}></td>
                <td className="border border-gray-300 p-3 text-right" colSpan={3}>
                  {activityData.all_categories.filter(cat => cat.scope === 'Scope 2').reduce((sum, cat) => sum + cat.emissions, 0).toFixed(1)}
                </td>
                <td className="border border-gray-300 p-3" colSpan={2}></td>
              </tr>

              {/* Scope 3 */}
              <tr className="bg-[#E2EFD9] font-bold">
                <td className="border border-gray-300 p-3" colSpan={8}>Scope 3 - Other Indirect Emissions</td>
              </tr>
              {activityData.all_categories
                .filter(cat => cat.scope === 'Scope 3')
                .map((item, idx) => (
                  <tr key={`s3-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="border border-gray-300 p-3" colSpan={2}>{item.report_label || item.category}</td>
                    <td className="border border-gray-300 p-3 text-center">3</td>
                    <td className="border border-gray-300 p-3 text-right" colSpan={3}>{item.emissions.toFixed(1)}</td>
                    <td className="border border-gray-300 p-3">{item.uom ? `${item.uom} Data` : 'Calculated'}</td>
                    <td className="border border-gray-300 p-3">{item.qty > 0 ? 'High' : 'Medium'}</td>
                  </tr>
                ))}
              {activityData.all_categories.filter(cat => cat.scope === 'Scope 3').length === 0 && (
                <tr className="bg-white">
                  <td className="border border-gray-300 p-3 text-muted-foreground italic" colSpan={2}>No Scope 3 emissions</td>
                  <td className="border border-gray-300 p-3 text-center">3</td>
                  <td className="border border-gray-300 p-3 text-right" colSpan={3}>0.0</td>
                  <td className="border border-gray-300 p-3">-</td>
                  <td className="border border-gray-300 p-3">-</td>
                </tr>
              )}
              <tr className="bg-[#E2EFD9] font-semibold">
                <td className="border border-gray-300 p-3" colSpan={3}></td>
                <td className="border border-gray-300 p-3 text-right" colSpan={3}>
                  {activityData.all_categories.filter(cat => cat.scope === 'Scope 3').reduce((sum, cat) => sum + cat.emissions, 0).toFixed(1)}
                </td>
                <td className="border border-gray-300 p-3" colSpan={2}></td>
              </tr>

              {/* Total */}
              <tr className="bg-gray-200 font-bold">
                <td className="border border-gray-300 p-3" colSpan={3}>TOTAL</td>
                <td className="border border-gray-300 p-3 text-right" colSpan={3}>{total.toFixed(1)}</td>
                <td className="border border-gray-300 p-3" colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Commentary Section */}
      <div className="mt-4 p-4 bg-gray-50 rounded-md">
        <p className="text-sm font-semibold mb-2">[commentary]</p>
        <p className="text-sm text-muted-foreground italic">
          Add custom commentary about emissions by activity here. This section can be edited in the Customize tab.
        </p>
      </div>
    </div>
  )
}
