-- Migration 007: rename drops → products, drop_id → product_id
ALTER TABLE raffles DROP CONSTRAINT raffles_drop_id_fkey;
ALTER TABLE raffles RENAME COLUMN drop_id TO product_id;
ALTER TABLE drops RENAME TO products;
ALTER TABLE raffles ADD CONSTRAINT raffles_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id);
