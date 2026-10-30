SELECT

    DATE_TRUNC('MONTH', transaction_date) AS sales_month,

    COUNT(*) AS total_orders,

    SUM(quantity) AS total_quantity,

    {{ calculate_revenue('total_amount') }} AS total_revenue,

    ROUND(AVG(total_amount), 2) AS average_order_value

FROM {{ ref('orders') }}

GROUP BY DATE_TRUNC('MONTH', transaction_date)

ORDER BY sales_month
