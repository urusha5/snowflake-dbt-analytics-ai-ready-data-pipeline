SELECT 'daily_sales' AS failing_model
WHERE ABS(
    (SELECT COALESCE(SUM(total_revenue), 0) FROM {{ ref('daily_sales') }})
    - (SELECT COALESCE(SUM(total_amount), 0) FROM {{ ref('orders') }})
) > 0.01
UNION ALL
SELECT 'category_sales'
WHERE ABS(
    (SELECT COALESCE(SUM(total_revenue), 0) FROM {{ ref('category_sales') }})
    - (SELECT COALESCE(SUM(total_amount), 0) FROM {{ ref('orders') }})
) > 0.01
