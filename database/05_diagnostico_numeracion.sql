-- SOLO LECTURA: no modifica ventas, índices ni secuencias.
SELECT current_setting('TimeZone') AS zona_sesion,
       now() AS instante_actual,
       (now() AT TIME ZONE 'America/La_Paz')::date AS dia_boliviano;
SELECT indexname,indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename IN ('Ventas','Clientes','Detalle_Venta')
 ORDER BY tablename,indexname;
SELECT id_venta,numero_diario,tipo,estado,fecha,
       (fecha AT TIME ZONE 'America/La_Paz')::date AS dia_boliviano
 FROM "Ventas" ORDER BY fecha DESC,numero_diario DESC LIMIT 50;
