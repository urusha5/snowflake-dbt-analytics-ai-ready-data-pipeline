SELECT

    COUNT(DISTINCT transaction_id) AS total_orders,

    COUNT(DISTINCT customer_id) AS total_customers,

    COUNT(DISTINCT product_id) AS total_products,

    SUM(quantity) AS total_units_sold,

    ROUND(SUM(total_amount), 2) AS total_revenue,

    ROUND(AVG(total_amount), 2) AS average_order_value,

    ROUND(
        SUM(total_amount)
        / NULLIF(COUNT(DISTINCT customer_id), 0),
        2
    ) AS average_customer_spend,

    ROUND(
        SUM(quantity)
        / NULLIF(COUNT(transaction_id), 0),
        2
    ) AS average_units_per_order

FROM {{ ref('orders') }}
