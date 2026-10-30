WITH customer_sales AS (

    SELECT

        c.customer_id,
        c.customer_type,
        c.email,
        c.age,
        c.gender,

        COUNT(o.transaction_id) AS total_orders,

        SUM(o.quantity) AS total_units,

        ROUND(SUM(o.total_amount), 2) AS lifetime_value,

        ROUND(AVG(o.total_amount), 2) AS average_order_value,

        MIN(o.transaction_date) AS first_purchase,

        MAX(o.transaction_date) AS last_purchase

    FROM {{ ref('customer') }} c

    LEFT JOIN {{ ref('orders') }} o
        ON c.customer_id = o.customer_id

    GROUP BY

        c.customer_id,
        c.customer_type,
        c.email,
        c.age,
        c.gender

)

SELECT

    customer_id,
    customer_type,
    email,
    age,
    gender,

    total_orders,
    total_units,
    lifetime_value,
    average_order_value,
    first_purchase,
    last_purchase,

    CASE

        WHEN lifetime_value >= 3000 THEN 'VIP'

        WHEN lifetime_value >= 1500 THEN 'Gold'

        WHEN lifetime_value >= 500 THEN 'Silver'

        ELSE 'Bronze'

    END AS customer_segment

FROM customer_sales

ORDER BY lifetime_value DESC
