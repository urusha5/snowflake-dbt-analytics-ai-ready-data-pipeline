SELECT

    transaction_date,

    COUNT(*) AS total_orders,

    SUM(quantity) AS total_quantity,

    {{ calculate_revenue('total_amount') }} AS total_revenue,

    ROUND(AVG(total_amount), 2) AS average_order_value,

    COUNT(DISTINCT customer_id) AS unique_customers,

    COUNT(DISTINCT product_id) AS unique_products

FROM {{ ref('orders') }}

GROUP BY transaction_date

ORDER BY transaction_date
