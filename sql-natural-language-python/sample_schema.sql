-- Sample schema + mock data for the SQL Natural Language example.
-- Run against an in-memory SQLite database.

CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    country TEXT,
    signup_date TEXT
);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    total REAL NOT NULL,
    status TEXT,
    created_at TEXT
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL,
    category TEXT
);

INSERT INTO customers (id, name, email, country, signup_date) VALUES
    (1, 'Acme Corp', 'billing@acme.com', 'US', '2024-01-15'),
    (2, 'Globex Inc', 'ap@globex.com', 'UK', '2024-03-22'),
    (3, 'Initech LLC', 'dev@initech.com', 'US', '2024-06-10'),
    (4, 'Umbrella AG', 'orders@umbrella.de', 'DE', '2024-09-05'),
    (5, 'Soylent BV', 'info@soylent.nl', 'NL', '2025-01-20');

INSERT INTO products (id, name, price, category) VALUES
    (101, 'SMS API Plan', 49.99, 'messaging'),
    (102, 'Voice Minute Bundle', 99.00, 'voice'),
    (103, 'Number Rental', 1.50, 'numbers'),
    (104, 'Storage Bucket', 10.00, 'storage'),
    (105, 'AI Inference Token', 0.002, 'ai');

INSERT INTO orders (id, customer_id, total, status, created_at) VALUES
    (1001, 1, 499.90, 'paid',    '2025-06-01 10:00:00'),
    (1002, 1, 99.00,  'paid',    '2025-06-15 14:30:00'),
    (1003, 2, 199.00, 'paid',    '2025-06-18 09:15:00'),
    (1004, 3, 10.00,  'pending', '2025-06-20 16:45:00'),
    (1005, 2, 49.99,  'paid',    '2025-06-22 11:20:00'),
    (1006, 4, 999.00, 'paid',    '2025-06-25 08:00:00'),
    (1007, 5, 1.50,   'paid',    '2025-06-28 13:10:00'),
    (1008, 1, 999.00, 'paid',    '2025-07-01 10:00:00'),
    (1009, 3, 99.00,  'refunded','2025-07-03 15:30:00'),
    (1010, 4, 49.99,  'paid',    '2025-07-05 09:45:00');
