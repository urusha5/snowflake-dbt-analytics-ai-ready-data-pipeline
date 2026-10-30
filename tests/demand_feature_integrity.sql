SELECT d.product_id, d.demand_date
FROM {{ ref('daily_demand_features') }} AS d
LEFT JOIN {{ ref('daily_demand_features') }} AS previous
    ON d.product_id = previous.product_id
    AND previous.demand_date = DATEADD('day', -1, d.demand_date)
WHERE d.units_sold < 0
    OR (previous.product_id IS NOT NULL AND (
        d.units_lag_1d IS NULL OR d.units_lag_1d <> previous.units_sold
    ))
UNION ALL
SELECT product_id, MAX(demand_date)
FROM {{ ref('daily_demand_features') }}
GROUP BY product_id
HAVING COUNT(*) <> DATEDIFF('day', MIN(demand_date), MAX(demand_date)) + 1
