WITH customer_metrics AS (

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

        COUNT(DISTINCT o.product_id) AS unique_products,

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

    *,

    DENSE_RANK() OVER (
        ORDER BY lifetime_value DESC
    ) AS customer_rank

FROM customer_metrics

ORDER BY customer_rank
