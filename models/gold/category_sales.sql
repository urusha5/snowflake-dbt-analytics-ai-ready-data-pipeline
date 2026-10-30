SELECT

    p.category,

    COUNT(o.transaction_id) AS total_orders,

    SUM(o.quantity) AS total_units_sold,

    {{ calculate_revenue('o.total_amount') }} AS total_revenue,

    ROUND(AVG(o.total_amount), 2) AS average_order_value

FROM {{ ref('orders') }} o

JOIN {{ ref('product') }} p
    ON o.product_id = p.product_id

GROUP BY p.category

ORDER BY total_revenue DESC
