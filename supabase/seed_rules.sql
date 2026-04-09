-- Seed the scheduling_rules table with existing hardcoded rules
INSERT INTO public.scheduling_rules (name, display_name, description, severity, is_enabled, parameters) VALUES
('headcount', 'Headcount Cap', 'Prevents overbooking shifts beyond the specified headcount limit.', 'error', true, '{"headcount_field": "headcount"}'),
('min_rest', 'Minimum Rest Period', 'Ensures employees have at least 12 hours rest between shifts.', 'error', true, '{"min_rest_hours": 12}'),
('night_followup', 'Night Shift Follow-up Restriction', 'Prevents morning and evening shifts the day after a night shift.', 'error', true, '{}'),
('new_employee_pairing', 'New Employee Pairing', 'Discourages pairing new employees together, especially on weekends.', 'warning', true, '{}'),
('consecutive_days', 'Consecutive Working Days', 'Warns about excessive consecutive working days based on weekly allocation.', 'warning', true, '{}'),
('night_rest_preference', 'Night Shift Rest Preference', 'Recommends 2 consecutive days off after night shifts.', 'warning', true, '{"rest_days_after_night": 2}'),
('fairness_info', 'Weekend/Holiday Fairness', 'Provides information about weekend and holiday shift allocation fairness.', 'warning', true, '{}')
ON CONFLICT (name) DO NOTHING;