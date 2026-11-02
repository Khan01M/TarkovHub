// Подключение к Supabase для входа и хранения прогресса.
// Сюда вписываются только ПУБЛИЧНЫЕ значения: адрес проекта и publishable-ключ (sb_publishable_…, или старый anon-ключ).
// Они и так видны в браузере любому посетителю, защита данных держится на правилах доступа в базе (supabase/setup.sql).
// Секретный ключ (sb_secret_… / service_role) сюда НИКОГДА не вписывать.
// Пока значения пустые, кнопка входа не показывается и сайт работает как раньше.

export const SUPABASE_URL = 'https://erzkitfpautpvetrqwnj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_B7SueDXeBLYU5hrm43AP0Q_aUWVYPjK';
