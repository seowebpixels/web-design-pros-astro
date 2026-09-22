-- 1. Insert Mock User
INSERT INTO users (id, name, email, phone, address) 
VALUES ('usr_01', 'Marlan Pather', 'marlan@webdesignpros.co.za', '0821234567', '15 Madge Avenue, Northcliff, Johannesburg, Gauteng, 2195');

-- 2. Insert Mock Domains
INSERT INTO domains (id, user_id, domain_name, status, next_due_date, auto_renew) 
VALUES 
('dom_01', 'usr_01', 'candlevents.co.za', 'active', '2027-09-08', 1),
('dom_02', 'usr_01', 'myclearsum.co.za', 'active', '2027-08-26', 1),
('dom_03', 'usr_01', 'myclearsum.com', 'active', '2027-08-26', 1),
('dom_04', 'usr_01', 'seowebpixels.com', 'active', '2027-05-09', 1),
('dom_05', 'usr_01', 'staragents.co.za', 'active', '2027-05-15', 1),
('dom_06', 'usr_01', 'starrecruitmentagents.co.za', 'active', '2027-05-15', 1);

-- 3. Insert Mock Services
INSERT INTO services (id, user_id, package_name, associated_domain, price, billing_cycle, next_due_date, status)
VALUES 
('srv_01', 'usr_01', 'Web Hosting - WebHosting Pro', 'webdesignpros.co.za', 'R70', 'Monthly', '2026-10-07', 'active'),
('srv_02', 'usr_01', 'Workplace - Workplace Starter', 'uncutelecmech.co.za', 'R96', 'Annually', '2026-08-01', 'pending');

-- 4. Insert Mock Invoices
INSERT INTO invoices (id, user_id, invoice_number, invoice_date, due_date, total_amount, status)
VALUES 
('inv_01', 'usr_01', '83784', '2026-08-01', '2026-08-01', 'R96', 'unpaid'),
('inv_02', 'usr_01', '89390', '2026-09-20', '2026-10-07', 'R70', 'unpaid'),
('inv_03', 'usr_01', '76230', '2026-05-15', '2026-05-15', 'R45', 'paid');