-- As-of features without direct identifiers or demographic attributes.
-- The salted hash is a pseudonym, not a guarantee of anonymization.
WITH parameters AS (
    SELECT {{ feature_as_of_date() }} AS feature_as_of_date
),
eligible_orders AS (
    SELECT o.*
    FROM {{ ref('orders') }} AS o
    CROSS JOIN parameters AS p
    WHERE o.transaction_date < p.feature_as_of_date
)
SELECT
    {{ customer_key('c.customer_id') }} AS customer_key,
    p.feature_as_of_date,
    COUNT(o.transaction_id) AS order_count,
    COALESCE(SUM(o.total_amount), 0)::NUMBER(18, 2) AS lifetime_value,
    ROUND(COALESCE(AVG(o.total_amount), 0), 2)::NUMBER(18, 2) AS average_order_value,
    DATEDIFF('day', MAX(o.transaction_date), p.feature_as_of_date) AS recency_days,
    COALESCE(COUNT_IF(o.transaction_date >= DATEADD('day', -30, p.feature_as_of_date)), 0) AS orders_30d,
    ROUND(SUM(IFF(o.transaction_date >= DATEADD('day', -30, p.feature_as_of_date), o.total_amount, 0)), 2)::NUMBER(18, 2) AS revenue_30d,
    COALESCE(COUNT_IF(o.transaction_date >= DATEADD('day', -90, p.feature_as_of_date)), 0) AS orders_90d,
    ROUND(SUM(IFF(o.transaction_date >= DATEADD('day', -90, p.feature_as_of_date), o.total_amount, 0)), 2)::NUMBER(18, 2) AS revenue_90d,
    COUNT(DISTINCT o.product_id) AS unique_products,
    MAX(o.transaction_date) AS last_purchase_date
FROM {{ ref('customer') }} AS c
CROSS JOIN parameters AS p
LEFT JOIN eligible_orders AS o ON c.customer_id = o.customer_id
WHERE c.created_at < p.feature_as_of_date
GROUP BY c.customer_id, p.feature_as_of_date
