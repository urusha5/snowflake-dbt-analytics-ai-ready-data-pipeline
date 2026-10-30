SELECT document_id
FROM {{ ref('product_knowledge') }}
WHERE LENGTH(TRIM(content)) < 20
    OR LENGTH(content) > 4000
    OR content LIKE '%@%'
    OR source_reference IS NULL
