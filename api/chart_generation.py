"""
Chart generation module for carbon reports.
Generates matplotlib charts as base64 encoded PNGs for PDF inclusion.
"""

import io
import base64
from typing import Optional
import numpy as np
from services.kaleido_browser import ensure_kaleido_browser

# Import matplotlib inside functions to avoid startup overhead
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
import matplotlib.ticker as ticker


def _configure_matplotlib():
    """Configure matplotlib for high-quality output."""
    plt.rcParams['figure.dpi'] = 300
    plt.rcParams['savefig.dpi'] = 300
    plt.rcParams['font.family'] = 'sans-serif'
    plt.rcParams['font.sans-serif'] = ['Arial', 'Helvetica', 'DejaVu Sans']
    plt.rcParams['axes.linewidth'] = 0.5
    plt.rcParams['axes.titlesize'] = 12
    plt.rcParams['axes.labelsize'] = 10


def create_donut_chart(data_dict: dict, colors_dict: dict, title: str, total_value: float, 
                       center_label: str = "tCO2e") -> str:
    """
    Create a donut chart and return as base64 encoded PNG.
    
    Args:
        data_dict: Dictionary with labels as keys and values as values
        colors_dict: Dictionary with labels as keys and hex colors as values
        title: Chart title
        total_value: Total value to display in center
        center_label: Label to show under the center value
    
    Returns:
        Base64 encoded PNG string
    """
    _configure_matplotlib()
    
    fig, ax = plt.subplots(figsize=(4, 4))
    
    # Filter out zero values for the chart
    labels = [k for k, v in data_dict.items() if v > 0]
    values = [v for v in data_dict.values() if v > 0]
    chart_colors = [colors_dict.get(k, '#999999') for k in labels]
    
    if not values:
        labels = ['No Data']
        values = [1]
        chart_colors = ['#CCCCCC']
    
    # Create labels with scope name, value with thousand separator, and percentage
    labels_with_data = []
    total = sum(values)
    for label, val in zip(labels, values):
        pct = (val / total * 100) if total > 0 else 0
        labels_with_data.append(f'{label}\n{val:,.1f} ({pct:.1f}%)')
    
    wedges, texts = ax.pie(
        values,
        labels=labels_with_data,
        colors=chart_colors,
        startangle=90,
        labeldistance=1.3,
        wedgeprops=dict(width=0.35, edgecolor='white', linewidth=2),
        textprops={'fontsize': 10, 'weight': 'normal', 'ha': 'center'}
    )
    
    for text in texts:
        text.set_fontsize(9)
        text.set_weight('normal')
    
    # Add center circle for donut effect
    centre_circle = Circle((0, 0), 0.60, fc='white', ec='none')
    ax.add_artist(centre_circle)
    
    ax.text(0, 0.05, f'{total_value:,.1f}', ha='center', va='center',
            fontsize=32, fontweight='bold', color='#70AD47',
            family='sans-serif')
    ax.text(0, -0.18, center_label, ha='center', va='center',
            fontsize=14, color='#70AD47', family='sans-serif')
    
    ax.axis('equal')
    
    img_buffer = io.BytesIO()
    plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none',
                pad_inches=0.2, transparent=False)
    plt.close(fig)
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def create_total_emissions_donut(
    scope_totals: dict,
    title: str = "Total Emissions",
    center_label: str = "tCO2e",
    period_from: str = "",
    period_to: str = ""
) -> str:
    """
    Create a professional, high-quality donut chart for the Total Emissions display.
    Features:
    - Thinner donut ring (25% less than before)
    - Legend positioned closer with less whitespace
    - Report period dates at the top
    - Professional typography and colors
    - Clear scope breakdown
    - Colored legend patches
    
    Args:
        scope_totals: Dictionary with 'Scope 1', 'Scope 2', 'Scope 3' keys and values
        title: Chart title (displayed above)
        center_label: Label to show under the center value
        period_from: Report period start date string
        period_to: Report period end date string
    
    Returns:
        Base64 encoded PNG string
    """
    _configure_matplotlib()
    
    # Set up figure - compact size
    fig, ax = plt.subplots(figsize=(8, 8))
    fig.patch.set_facecolor('white')
    
    # Prepare data - filter out zero values
    scope_labels = ['Scope 1', 'Scope 2', 'Scope 3']
    values = [scope_totals.get(scope, 0) for scope in scope_labels]
    total = sum(values)
    
    # Professional color palette - distinct, vibrant colors
    colors = ['#4472C4', '#ED7D31', '#70AD47']  # Blue, Orange, Green
    
    if total == 0:
        # Handle empty data case
        values = [1]
        scope_labels = ['No Data']
        colors = ['#E0E0E0']
        total = 1
    
    # Donut width reduced by 25% (from 0.35 to ~0.2625)
    donut_width = 0.2625
    
    # Create the pie chart with thinner donut
    wedges, texts, autotexts = ax.pie(
        values,
        labels=None,  # We'll add legend separately
        colors=colors[:len(values)] if len(values) == 3 else colors,
        startangle=90,
        center=(0, 0),
        wedgeprops=dict(
            width=donut_width,
            edgecolor='white',
            linewidth=2,
        ),
        textprops=dict(
            fontsize=16,
            fontweight='bold',
            color='white',
            ha='center',
            va='center'
        ),
        autopct=''
    )
    
    # Create inner white circle for clean donut effect
    inner_circle = Circle(
        (0, 0), 
        1 - donut_width - 0.02,
        fc='white', 
        ec='none'
    )
    ax.add_patch(inner_circle)
    
    # Add center text - total value and small label
    ax.text(
        0, 0.05, 
        f'{total:,.1f}',
        ha='center', 
        va='center',
        fontsize=42,
        fontweight='bold',
        color='#333333',
        family='Arial'
    )
    ax.text(
        0, -0.18, 
        center_label,
        ha='center', 
        va='center',
        fontsize=14,
        fontweight='normal',
        color='#666666',
        family='Arial'
    )
    
    # Add report period at the top if provided (bold, larger font)
    if period_from or period_to:
        period_text = f"{period_from} - {period_to}" if period_from and period_to else (period_from or period_to)
        ax.text(
            0, 1.25,
            period_text,
            ha='center',
            va='center',
            fontsize=24,  # 2x larger
            fontweight='bold',  # Bold
            color='#333333',
            family='Arial'
        )
    
    # Add legend closer to the donut with scope values and percentages (larger font)
    legend_labels = []
    for i in range(len(values)):
        if total > 0 and values[i] > 0:
            pct = (values[i] / total) * 100
            scope_name = scope_labels[i] if i < len(scope_labels) else f'Scope {i+1}'
            legend_labels.append(f"{scope_name}: {values[i]:,.1f} tCO2e ({pct:.1f}%)")
        elif i < len(scope_labels):
            legend_labels.append(f"{scope_labels[i]}: {values[i]:,.1f} tCO2e")
    
    # Create colored patches for legend
    from matplotlib.patches import Patch
    legend_patches = [Patch(facecolor=colors[i], edgecolor='white') for i in range(len(values))]
    
    # Add legend box positioned closer to donut with larger font
    legend = ax.legend(
        legend_patches,
        legend_labels,
        loc='lower center',
        bbox_to_anchor=(0.5, -0.20),  # Moved further down to avoid overlap
        frameon=False,
        labelspacing=0.6,  # Tighter spacing
        prop=dict(family='Arial', size=14, weight='normal'),  # 2x larger
    )
    
    # Style legend text
    for text in legend.get_texts():
        text.set_color('#333333')
    
    # Equal aspect ratio and remove axes
    ax.set_aspect('equal')
    ax.axis('off')
    
    # Adjust layout
    plt.tight_layout()
    
    # Save to buffer
    img_buffer = io.BytesIO()
    plt.savefig(
        img_buffer, 
        format='png', 
        dpi=300, 
        bbox_inches='tight',
        facecolor='white', 
        edgecolor='none',
        pad_inches=0.2,
        transparent=False
    )
    plt.close(fig)
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def create_activity_donut(
    activity_totals: dict,
    activity_colors: dict = None,
    title: str = "Emissions by Activity",
    center_label: str = "tCO2e",
    period_from: str = "",
    period_to: str = "",
    total_value: float = None
) -> str:
    """
    Create a professional donut chart for Emissions by Activity.
    Same style as the total emissions donut.
    
    Args:
        activity_totals: Dictionary with activity names as keys and emission values as values
        activity_colors: Dictionary mapping activity names to hex colors
        title: Chart title (not displayed in chart)
        center_label: Label to show under the center value
        period_from: Report period start date string
        period_to: Report period end date string
        total_value: Optional total value to display in center (defaults to sum of activity values)
    
    Returns:
        Base64 encoded PNG string
    """
    _configure_matplotlib()
    
    # Set up figure - tuned for card rendering in HTML/PDF
    fig, ax = plt.subplots(figsize=(6.4, 6.0))
    fig.patch.set_facecolor('white')
    
    # Prepare data and filter out zero rows to avoid noisy legends
    filtered_items = [
        (str(label), float(value or 0.0))
        for label, value in activity_totals.items()
        if float(value or 0.0) > 0
    ]
    activity_labels = [label for label, _ in filtered_items]
    values = [value for _, value in filtered_items]
    
    # Default colors if not provided
    if activity_colors is None:
        activity_colors = {
            'Energy': '#4472C4',
            'Business Travel': '#ED7D31',
            'Employee Commuting': '#A5A5A5',
            'Purchased Goods & Services (PG&S)': '#8064A2',
            'Other Emissions': '#70AD47',
        }
    
    colors = [activity_colors.get(label, '#999999') for label in activity_labels]
    
    # Use provided total_value or calculate from activity totals
    calc_total = sum(values)
    total = total_value if total_value is not None else calc_total
    
    if total == 0:
        # Handle empty data case
        values = [1]
        activity_labels = ['No Data']
        colors = ['#E0E0E0']
        total = 1
    
    # Donut width reduced by 25% (same as total emissions)
    donut_width = 0.2625
    
    # Create the pie chart with thinner donut
    wedges, texts, autotexts = ax.pie(
        values,
        labels=None,
        colors=colors[:len(values)],
        startangle=90,
        center=(0, 0),
        wedgeprops=dict(
            width=donut_width,
            edgecolor='white',
            linewidth=2,
        ),
        textprops=dict(
            fontsize=11,
            fontweight='bold',
            color='white',
            ha='center',
            va='center'
        ),
        autopct=''
    )
    
    # Create inner white circle for clean donut effect
    inner_circle = Circle(
        (0, 0), 
        1 - donut_width - 0.02,
        fc='white', 
        ec='none'
    )
    ax.add_patch(inner_circle)
    
    # Add center text - total value and small label
    ax.text(
        0, 0.05, 
        f'{total:,.1f}',
        ha='center', 
        va='center',
        fontsize=31,
        fontweight='bold',
        color='#333333',
        family='Arial'
    )
    ax.text(
        0, -0.18, 
        center_label,
        ha='center', 
        va='center',
        fontsize=10,
        fontweight='normal',
        color='#666666',
        family='Arial'
    )
    
    # Add report period at the top if provided (bold, larger font)
    if period_from or period_to:
        period_text = f"{period_from} - {period_to}" if period_from and period_to else (period_from or period_to)
        ax.text(
            0, 1.25,
            period_text,
            ha='center',
            va='center',
            fontsize=14,
            fontweight='bold',
            color='#333333',
            family='Arial'
        )
    
    # Add legend closer to the donut with activity values and percentages (larger font)
    legend_labels = []
    for i in range(len(values)):
        if total > 0 and values[i] > 0:
            pct = (values[i] / total) * 100
            legend_labels.append(f"{activity_labels[i]}: {values[i]:,.1f} tCO2e ({pct:.1f}%)")
        elif i < len(activity_labels):
            legend_labels.append(f"{activity_labels[i]}: {values[i]:,.1f} tCO2e")
    
    # Create colored patches for legend
    from matplotlib.patches import Patch
    legend_patches = [Patch(facecolor=colors[i], edgecolor='white') for i in range(len(values))]
    
    # Add legend box positioned below the donut with larger font
    legend = ax.legend(
        legend_patches,
        legend_labels,
        loc='lower center',
        bbox_to_anchor=(0.5, -0.07),
        frameon=False,
        labelspacing=0.4,
        prop=dict(family='Arial', size=8.8, weight='normal'),
    )
    
    # Style legend text
    for text in legend.get_texts():
        text.set_color('#333333')
    
    # Equal aspect ratio and remove axes
    ax.set_aspect('equal')
    ax.axis('off')
    
    # Adjust layout
    plt.tight_layout()
    
    # Save to buffer
    img_buffer = io.BytesIO()
    plt.savefig(
        img_buffer, 
        format='png', 
        dpi=300, 
        bbox_inches='tight',
        facecolor='white', 
        edgecolor='none',
        pad_inches=0.08,
        transparent=False
    )
    plt.close(fig)
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def create_bar_chart(data_dict: dict, colors_dict: dict, title: str, 
                    xlabel: str = "Category", ylabel: str = "tCO2e") -> str:
    """
    Create a horizontal bar chart and return as base64 encoded PNG.
    
    Args:
        data_dict: Dictionary with labels as keys and values as values
        colors_dict: Dictionary with labels as keys and hex colors as values
        title: Chart title
        xlabel: X-axis label
        ylabel: Y-axis label
    
    Returns:
        Base64 encoded PNG string
    """
    _configure_matplotlib()
    
    # Sort by value descending
    sorted_items = sorted(data_dict.items(), key=lambda x: x[1], reverse=True)
    labels = [k for k, v in sorted_items if v > 0]
    values = [v for k, v in sorted_items if v > 0]
    
    if not values:
        labels = ['No Data']
        values = [1]
    
    colors = [colors_dict.get(k, '#4472C4') for k in labels]
    
    fig, ax = plt.subplots(figsize=(6, 4))
    
    y_pos = range(len(labels))
    bars = ax.barh(y_pos, values, color=colors, edgecolor='white', linewidth=0.5)
    
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()  # Labels read top-to-bottom
    ax.set_xlabel(ylabel, fontsize=10)
    ax.set_title(title, fontsize=12, fontweight='bold', pad=10)
    
    # Add value labels on bars
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + max(values) * 0.02, bar.get_y() + bar.get_height()/2,
                f'{val:,.1f}', va='center', fontsize=9)
    
    ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, p: f'{x:,.0f}'))
    ax.set_xlim(0, max(values) * 1.15)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    
    plt.tight_layout()
    
    img_buffer = io.BytesIO()
    plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def create_reduction_pathway_chart(
    baseline_year: int,
    baseline_emissions: dict[str, float],  # {'Scope 1': x, 'Scope 2': y, 'Scope 3': z}
    target_year: int,
    target_percent_reduction: int,
    net_zero_year: Optional[int] = None,
    milestones: Optional[list[dict]] = None,  # [{'year': 2030, 'pct': 30}, ...]
    title: str = "Reduction Pathway",
    figsize: tuple = (7, 4)  # Default A4-friendly size
) -> str:
    """
    Create a line chart showing emissions reduction pathway over time using Plotly.
    
    Args:
        baseline_year: The baseline year (e.g., 2024)
        baseline_emissions: Emissions by scope at baseline
        target_year: Net zero target year (e.g., 2050)
        target_percent_reduction: Target % reduction (e.g., 100 for net zero)
        net_zero_year: Optional explicit net zero year
        milestones: Optional list of milestone points
        title: Chart title
        figsize: Figure size tuple (width, height) - width, height in inches
    
    Returns:
        Base64 encoded PNG string
    """
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    
    if net_zero_year is None:
        net_zero_year = target_year
    
    # Build data points
    years = list(range(baseline_year, net_zero_year + 1))
    
    # Calculate reduction trajectory for each scope
    scope_colors = {
        'Scope 1': '#4472C4',
        'Scope 2': '#ED7D31', 
        'Scope 3': '#70AD47'
    }
    
    # Create figure
    fig = go.Figure()
    
    for scope in ['Scope 1', 'Scope 2', 'Scope 3']:
        if scope not in baseline_emissions:
            continue
            
        scope_baseline = baseline_emissions.get(scope, 0)
        if scope_baseline <= 0:
            continue
        
        # Linear reduction to target
        emissions_values = []
        for year in years:
            years_elapsed = year - baseline_year
            total_years = net_zero_year - baseline_year
            
            if total_years > 0:
                # Linear reduction
                reduction_factor = (years_elapsed / total_years) * (target_percent_reduction / 100)
                reduced = scope_baseline * (1 - reduction_factor)
            else:
                reduced = scope_baseline
            
            # Don't go below zero
            emissions_values.append(max(0, reduced))
        
        color = scope_colors.get(scope, '#999999')
        
        # Add line with markers
        fig.add_trace(go.Scatter(
            x=years,
            y=emissions_values,
            mode='lines+markers',
            name=scope,
            line=dict(color=color, width=3),
            marker=dict(size=8, symbol='circle')
        ))
    
    # Add vertical lines for baseline and target
    fig.add_vline(x=baseline_year, line_dash="dot", line_color="#333333", 
                  annotation_text=f"Baseline {baseline_year}", annotation_position="top left")
    fig.add_vline(x=net_zero_year, line_dash="dash", line_color="#70AD47",
                  annotation_text=f"Net Zero {net_zero_year}", annotation_position="bottom right")
    
    # Update layout for professional look
    fig.update_layout(
        title=dict(
            text=title,
            font=dict(size=16, color='#333333', family='Arial, sans-serif'),
            x=0.5,
            xanchor='center'
        ),
        xaxis=dict(
            title=dict(text='Year', font=dict(size=12, family='Arial, sans-serif')),
            tickmode='array',
            tickvals=years,
            ticktext=[str(y) for y in years],
            tickangle=-45,
            showgrid=False,
            zeroline=False,
            showline=True,
            linecolor='#333333',
            ticks='outside'
        ),
        yaxis=dict(
            title=dict(text='Emissions (tCO2e)', font=dict(size=12, family='Arial, sans-serif')),
            showgrid=False,
            zeroline=False,
            showline=True,
            linecolor='#333333',
            tickformat=',.0f',
            ticks='outside'
        ),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=1.02,
            xanchor='right',
            x=1,
            font=dict(size=11)
        ),
        plot_bgcolor='white',
        paper_bgcolor='white',
        margin=dict(l=60, r=30, t=80, b=80),
        height=int(figsize[1] * 100),  # Convert to pixels approximately
        width=int(figsize[0] * 100),
        font=dict(family='Arial, sans-serif', size=11)
    )
    
    # Add annotations for milestones if provided
    if milestones:
        for ms in milestones:
            ms_year = ms.get('year')
            ms_pct = ms.get('pct', 0)
            if ms_year and baseline_year <= ms_year <= net_zero_year:
                # Find approximate y position
                fig.add_annotation(
                    x=ms_year,
                    y=max(baseline_emissions.values()) * 0.95,
                    text=f"{ms_pct}%",
                    showarrow=True,
                    arrowhead=2,
                    arrowsize=1,
                    arrowwidth=1,
                    ax=0,
                    ay=-20,
                    font=dict(size=10, color='#666666')
                )
    
    # Export to PNG
    ensure_kaleido_browser()
    img_buffer = io.BytesIO()
    fig.write_image(img_buffer, format='png', scale=2, width=900, height=500,
                    engine='kaleido')
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def create_interim_pathway_chart(
    baseline_year: int,
    baseline_emissions: dict[str, float],
    interim_year: int,
    interim_percent_reduction: int,
    target_year: int,
    target_percent_reduction: int,
    title: str = "Pathway to Interim Target"
) -> str:
    """
    Create a line chart showing pathway to interim target.
    Simplified version focusing on the period up to interim target.
    """
    return create_reduction_pathway_chart(
        baseline_year=baseline_year,
        baseline_emissions=baseline_emissions,
        target_year=interim_year,
        target_percent_reduction=interim_percent_reduction,
        net_zero_year=target_year,
        milestones=[
            {'year': interim_year, 'pct': interim_percent_reduction}
        ],
        title=title
    )


def create_intensity_pathway_chart(
    baseline_year: int,
    baseline_intensity: float,
    baseline_metric_value: float,
    target_year: int,
    target_percent_reduction: int,
    metric_name: str = "per £1000 revenue",
    title: str = "Intensity Reduction Pathway"
) -> str:
    """
    Create a line chart showing intensity metric reduction pathway using Plotly.
    
    Args:
        baseline_year: The baseline year
        baseline_intensity: Baseline intensity value (e.g., tCO2e per employee)
        baseline_metric_value: The baseline metric value (e.g., number of employees)
        target_year: Target year
        target_percent_reduction: Target % reduction
        metric_name: Name of the intensity metric
        title: Chart title
    
    Returns:
        Base64 encoded PNG string
    """
    import plotly.graph_objects as go
    
    years = list(range(baseline_year, target_year + 1))
    
    # Calculate intensity values over time (assuming linear reduction)
    intensity_values = []
    total_years = target_year - baseline_year
    
    for year in years:
        years_elapsed = year - baseline_year
        if total_years > 0:
            reduction_factor = (years_elapsed / total_years) * (target_percent_reduction / 100)
            intensity = baseline_intensity * (1 - reduction_factor)
        else:
            intensity = baseline_intensity
        intensity_values.append(max(0, intensity))
    
    final_intensity = baseline_intensity * (1 - target_percent_reduction/100)
    
    # Create figure
    fig = go.Figure()
    
    # Add line with markers
    fig.add_trace(go.Scatter(
        x=years,
        y=intensity_values,
        mode='lines+markers',
        name=f'Intensity {metric_name}',
        line=dict(color='#4472C4', width=3),
        marker=dict(size=10, symbol='circle')
    ))
    
    # Add vertical lines for baseline and target
    fig.add_vline(x=baseline_year, line_dash="dot", line_color="#333333", 
                  annotation_text=f"Baseline {baseline_year}", annotation_position="top left")
    fig.add_vline(x=target_year, line_dash="dash", line_color="#70AD47",
                  annotation_text=f"Target {target_year}", annotation_position="bottom right")
    
    # Update layout for professional look
    fig.update_layout(
        title=dict(
            text=title,
            font=dict(size=16, color='#333333', family='Arial, sans-serif'),
            x=0.5,
            xanchor='center'
        ),
        xaxis=dict(
            title=dict(text='Year', font=dict(size=12, family='Arial, sans-serif')),
            tickmode='array',
            tickvals=years,
            ticktext=[str(y) for y in years],
            tickangle=-45,
            showgrid=False,
            zeroline=False,
            showline=True,
            linecolor='#333333',
            ticks='outside'
        ),
        yaxis=dict(
            title=dict(text=f'Intensity (tCO2e {metric_name})', font=dict(size=12, family='Arial, sans-serif')),
            showgrid=False,
            zeroline=False,
            showline=True,
            linecolor='#333333',
            tickformat='.2f',
            ticks='outside'
        ),
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=1.02,
            xanchor='right',
            x=1,
            font=dict(size=11)
        ),
        plot_bgcolor='white',
        paper_bgcolor='white',
        margin=dict(l=60, r=30, t=80, b=80),
        height=500,
        width=800,
        font=dict(family='Arial, sans-serif', size=11)
    )
    
    # Export to PNG
    ensure_kaleido_browser()
    img_buffer = io.BytesIO()
    fig.write_image(img_buffer, format='png', scale=2, width=800, height=500,
                    engine='kaleido')
    img_buffer.seek(0)
    
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')
    return img_base64


def generate_report_assets(
    job_data: dict,
    scope_totals: dict,
    categories: list[dict],
    activity_totals: dict,
    intensity_metrics: Optional[list[dict]] = None,
    target_data: Optional[dict] = None
) -> dict:
    """
    Generate all required charts for a carbon report.
    
    Args:
        job_data: Job data dictionary
        scope_totals: Scope emissions totals
        categories: Category breakdown
        activity_totals: Activity group totals
        intensity_metrics: Optional intensity metrics
        target_data: Optional target data with baseline_year, net_zero_target_year, etc.
    
    Returns:
        Dictionary of chart assets with keys:
        - scope_breakdown: Scope donut chart
        - activity_breakdown: Activity donut chart
        - activity_bar: Activity bar chart
        - reduction_pathway_2050: Full pathway to 2050
        - reduction_pathway_interim: Pathway to interim target
        - intensity_pathway_per_fte: Per employee intensity (if available)
        - intensity_pathway_per_revenue: Per revenue intensity (if available)
    """
    assets = {}
    period_text = f"{job_data.get('period_start', 'N/A')} to {job_data.get('period_end', 'N/A')}"
    
    # Scope donut chart
    scope_chart_data = {
        'Scope 1': scope_totals.get('Scope 1', 0),
        'Scope 2': scope_totals.get('Scope 2', 0),
        'Scope 3': scope_totals.get('Scope 3', 0)
    }
    scope_colors = {
        'Scope 1': '#4472C4',
        'Scope 2': '#ED7D31',
        'Scope 3': '#70AD47'
    }
    # Professional total emissions donut chart (for Executive Summary)
    # Format period dates for the chart
    period_from = job_data.get('period_start', '')
    period_to = job_data.get('period_end', '')
    if hasattr(period_from, 'strftime'):
        period_from = period_from.strftime('%d %b %Y')
    if hasattr(period_to, 'strftime'):
        period_to = period_to.strftime('%d %b %Y')
    
    assets['total_emissions'] = create_total_emissions_donut(
        scope_totals,
        title="Total Emissions",
        center_label="tCO2e",
        period_from=period_from,
        period_to=period_to
    )
    
    # Scope breakdown donut chart
    assets['scope_breakdown'] = create_donut_chart(
        scope_chart_data,
        scope_colors,
        f'Emissions by Scope (tCO2e)\n{period_text}',
        scope_totals.get('Total', 0)
    )
    
    # Activity donut chart - using new professional style (same as total emissions donut)
    assets['activity_breakdown'] = create_activity_donut(
        activity_totals,
        activity_colors=ACTIVITY_GROUP_COLORS,
        title="Emissions by Activity",
        center_label="tCO2e",
        period_from=period_from,
        period_to=period_to,
        total_value=scope_totals.get('Total', sum(activity_totals.values()))
    )
    
    # Activity bar chart
    assets['activity_bar'] = create_bar_chart(
        activity_totals,
        ACTIVITY_GROUP_COLORS,
        'Emissions by Activity Group (tCO2e)'
    )
    
    # Reduction pathway charts (if target data available and has valid baseline_year)
    if target_data:
        # Get baseline_year with safe fallback
        baseline_year = target_data.get('baseline_year')
        if baseline_year is None:
            # Try to derive from reporting year
            reporting_year = job_data.get('reporting_year', 2024)
            if reporting_year:
                baseline_year = reporting_year - 1
            else:
                baseline_year = 2023  # Default fallback
        
        # Skip pathway charts if baseline_year is still invalid
        if baseline_year and isinstance(baseline_year, int) and baseline_year > 2000:
            net_zero_year = target_data.get('net_zero_target_year', 2050)
            
            baseline_emissions = {
                'Scope 1': scope_totals.get('Scope 1', 0),
                'Scope 2': scope_totals.get('Scope 2', 0),
                'Scope 3': scope_totals.get('Scope 3', 0)
            }
            
            # Determine interim year
            interim_year = target_data.get('interim_target_year')
            if interim_year is None:
                # Use explicit interim year from client or default
                interim_year = target_data.get('interim_year', 2035)
            
            # Get target percentages from client data
            interim_pct = target_data.get('interim_pct', 50)  # Default 50%
            target_pct = target_data.get('target_pct', 100)  # Default 100% (net zero)
            
            # Full pathway to 2050 - use smaller size for A4 compatibility
            assets['reduction_pathway_2050'] = create_reduction_pathway_chart(
                baseline_year=baseline_year,
                baseline_emissions=baseline_emissions,
                target_year=2050,
                target_percent_reduction=100,
                net_zero_year=net_zero_year,
                title="Emissions Reduction Pathway to 2050",
                figsize=(7, 4)  # Smaller for A4
            )
            
            # Interim pathway - use smaller size for A4 compatibility
            assets['reduction_pathway_interim'] = create_interim_pathway_chart(
                baseline_year=baseline_year,
                baseline_emissions=baseline_emissions,
                interim_year=interim_year,
                interim_percent_reduction=interim_pct,
                target_year=net_zero_year,
                target_percent_reduction=target_pct,
                title=f'Pathway to Interim Target ({interim_year})'
            )
            
            # Intensity pathways (if metrics available)
            if intensity_metrics:
                for metric in intensity_metrics:
                    metric_name = metric.get('name', '')
                    emissions = metric.get('emissions', 0)
                    metric_value = metric.get('value', 1)
                    
                    if metric_value > 0:
                        intensity = emissions / metric_value
                        
                        if 'fte' in metric_name.lower() or 'employee' in metric_name.lower() or 'staff' in metric_name.lower():
                            assets['intensity_pathway_per_fte'] = create_intensity_pathway_chart(
                                baseline_year=baseline_year,
                                baseline_intensity=intensity,
                                baseline_metric_value=metric_value,
                                target_year=interim_year,
                                target_percent_reduction=interim_pct,
                                metric_name='per employee',
                                title='Carbon Intensity per Employee'
                            )
                        
                        if 'revenue' in metric_name.lower() or 'turnover' in metric_name.lower() or 'sales' in metric_name.lower():
                            # Assume value is in thousands for revenue
                            assets['intensity_pathway_per_revenue'] = create_intensity_pathway_chart(
                                baseline_year=baseline_year,
                                baseline_intensity=intensity * 1000,  # Convert to per £1000
                                baseline_metric_value=metric_value * 1000,
                                target_year=interim_year,
                                target_percent_reduction=interim_pct,
                                metric_name='per £1000 revenue',
                                title='Carbon Intensity per £1000 Revenue'
                            )
    
    return assets


# Activity group colors (used by generate_report_assets)
ACTIVITY_GROUP_ORDER = [
    'Energy',
    'Business Travel',
    'Employee Commuting',
    'Purchased Goods & Services (PG&S)',
    'Other Emissions',
]

ACTIVITY_GROUP_COLORS = {
    'Energy': '#4472C4',
    'Business Travel': '#ED7D31',
    'Employee Commuting': '#A5A5A5',
    'Purchased Goods & Services (PG&S)': '#8064A2',
    'Other Emissions': '#70AD47',
}


# Required asset keys for validation
REQUIRED_ASSETS = [
    'total_emissions',
    'scope_breakdown',
    'activity_breakdown',
    'activity_bar',
    'reduction_pathway_2050',
    'reduction_pathway_interim',
]


def validate_report_assets(assets: dict, required_keys: list[str] = None) -> tuple[bool, list[str]]:
    """
    Validate that all required chart assets are present and valid.
    
    Args:
        assets: Dictionary of generated assets
        required_keys: List of required asset keys (defaults to REQUIRED_ASSETS)
    
    Returns:
        Tuple of (is_valid, missing_keys)
    """
    if required_keys is None:
        required_keys = REQUIRED_ASSETS
    
    missing_keys = []
    
    for key in required_keys:
        if key not in assets:
            missing_keys.append(key)
        elif not assets[key] or assets[key] == '':
            missing_keys.append(key)
    
    return (len(missing_keys) == 0, missing_keys)
