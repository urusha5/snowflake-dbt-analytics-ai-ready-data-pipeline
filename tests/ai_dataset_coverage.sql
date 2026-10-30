SELECT 'customer_features' AS empty_model
WHERE NOT EXISTS (SELECT 1 FROM {{ ref('customer_features') }})
UNION ALL
SELECT 'product_knowledge'
WHERE NOT EXISTS (SELECT 1 FROM {{ ref('product_knowledge') }})
UNION ALL
SELECT 'daily_demand_features'
WHERE NOT EXISTS (SELECT 1 FROM {{ ref('daily_demand_features') }})
