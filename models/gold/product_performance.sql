SELECT

    p.product_id,

    p.name AS product_name,

    p.category,

    p.price,

    p.stock_quantity,

    p.rating,

    COUNT(o.transaction_id) AS total_orders,

    COALESCE(SUM(o.quantity), 0) AS total_units_sold,

    ROUND(COALESCE(SUM(o.total_amount), 0), 2) AS total_revenue,

    ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS average_order_value

FROM {{ ref('product') }} p

LEFT JOIN {{ ref('orders') }} o
    ON p.product_id = o.product_id

GROUP BY

    p.product_id,
    p.name,
    p.category,
    p.price,
    p.stock_quantity,
    p.rating
