-- Stable text documents and provenance for a future retrieval index.
-- No embeddings or external model calls are performed here.
SELECT
    SHA2(CONCAT('product:', TO_VARCHAR(product_id)), 256) AS document_id,
    product_id,
    name AS product_name,
    category,
    CONCAT(
        'Product: ', COALESCE(name, 'Unknown'),
        '. Category: ', COALESCE(category, 'Uncategorized'),
        '. Price: $', COALESCE(TO_VARCHAR(price), 'unknown'),
        '. Rating: ', COALESCE(TO_VARCHAR(rating), 'unrated'), '/5.',
        ' Stock: ', COALESCE(TO_VARCHAR(stock_quantity), 'unknown'), ' units.'
    ) AS content,
    CONCAT('product/', TO_VARCHAR(product_id)) AS source_reference,
    {{ feature_as_of_date() }} AS updated_as_of
FROM {{ ref('product') }}
