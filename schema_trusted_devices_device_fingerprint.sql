alter table if exists trusted_devices
add column if not exists device_fingerprint text;

create index if not exists idx_trusted_devices_user_device_fingerprint
on trusted_devices (user_id, device_fingerprint);

create index if not exists idx_trusted_devices_expires_at
on trusted_devices (expires_at);
