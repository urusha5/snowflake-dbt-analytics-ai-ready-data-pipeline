SELECT customer_key
FROM {{ ref('customer_features') }}
WHERE last_purchase_date >= feature_as_of_date
    OR recency_days < 0
    OR orders_30d > orders_90d
    OR orders_90d > order_count
    OR revenue_30d > revenue_90d
    OR revenue_90d > lifetime_value
    OR LENGTH(customer_key) <> 64
