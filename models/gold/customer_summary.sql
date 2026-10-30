SELECT
    c.customer_id,
    c.customer_type,
    c.email,
    c.age,
    c.gender,

    COUNT(o.transaction_id) AS total_orders,

    COALESCE(SUM(o.quantity), 0) AS total_quantity,

    COALESCE(SUM(o.total_amount), 0) AS lifetime_value,

    ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS average_order_value,

    MIN(o.transaction_date) AS first_purchase_date,

    MAX(o.transaction_date) AS last_purchase_date

FROM {{ ref('customer') }} c

LEFT JOIN {{ ref('orders') }} o
    ON c.customer_id = o.customer_id

GROUP BY
    c.customer_id,
    c.customer_type,
    c.email,
    c.age,
    c.gender
