-- Complete daily spine, including zero-sales days. Features exclude the
-- target day's sales. Leading lags stay NULL. units_sold is the target.
WITH parameters AS (
    SELECT {{ feature_as_of_date() }} AS feature_as_of_date
),
bounds AS (
    SELECT MIN(o.transaction_date)::DATE AS first_date, p.feature_as_of_date
    FROM {{ ref('orders') }} AS o
    CROSS JOIN parameters AS p
    WHERE o.transaction_date < p.feature_as_of_date
    GROUP BY p.feature_as_of_date
),
dates AS (
    SELECT DATEADD('day', f.value::INTEGER, b.first_date)::DATE AS demand_date
    FROM bounds AS b,
        LATERAL FLATTEN(INPUT => ARRAY_GENERATE_RANGE(0, DATEDIFF('day', b.first_date, b.feature_as_of_date))) AS f
),
daily AS (
    SELECT
        p.product_id,
        d.demand_date,
        COALESCE(SUM(o.quantity), 0) AS units_sold,
        ROUND(COALESCE(SUM(o.total_amount), 0), 2) AS revenue
    FROM {{ ref('product') }} AS p
    JOIN dates AS d ON d.demand_date >= p.available_from
    LEFT JOIN {{ ref('orders') }} AS o
        ON p.product_id = o.product_id AND d.demand_date = o.transaction_date
    GROUP BY p.product_id, d.demand_date
)
SELECT
    product_id,
    demand_date,
    units_sold,
    revenue::NUMBER(18, 2) AS revenue,
    LAG(units_sold, 1) OVER (PARTITION BY product_id ORDER BY demand_date) AS units_lag_1d,
    LAG(units_sold, 7) OVER (PARTITION BY product_id ORDER BY demand_date) AS units_lag_7d,
    ROUND(AVG(units_sold) OVER (
        PARTITION BY product_id ORDER BY demand_date
        ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING
    ), 2)::NUMBER(18, 2) AS avg_units_previous_7d
FROM daily
