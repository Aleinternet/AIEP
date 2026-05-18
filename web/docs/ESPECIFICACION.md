# Especificación breve

## Objetivo

Centralizar cartera REMESA / AIEP, gestiones de ejecutivos, campañas, portal deudor, conciliación bancaria y reportabilidad gerencial.

## Roles

- Gerencia: dashboard, campañas, conciliación, reportes y validaciones.
- Ejecutivo: cartera asignada, ficha del deudor, contacto y registro de gestión.
- Deudor: estado de deuda, oferta, datos de transferencia y carga de comprobante.
- Administrador: configuración, usuarios, plantillas, permisos y auditoría.

## Ingreso

- Deudor: RUT titular, RUT alumno o RUT deudor, sin contraseña. El sistema normaliza puntos, guion y espacios.
- Ejecutivo call center: usuario `callcenter`, contraseña `123456`.
- Jefatura: usuario `remesa`, contraseña `654321`.

## Regla comercial implementada

La campaña de liquidación calcula `monto_oferta = saldo_capital * 50%`.

`deuda_total` se muestra solo como referencia porque puede incluir intereses y gastos de cobranza.

## Módulos incluidos en el MVP

- Dashboard gerencial con KPIs, estados, contactabilidad, cartola y ejecutivos.
- Cartera con filtros por estado, ejecutivo y buscador global.
- Ficha rápida de deudor con deuda, oferta, contactos y observaciones.
- Registro local de gestión para prototipo operativo.
- Campañas con selección simulada y plantilla WhatsApp.
- Conciliación con movimientos bancarios normalizados.
- Portal deudor preliminar con oferta y datos de transferencia.

## Persistencia local

La bitácora, marcas de contactos y archivos cargados se almacenan localmente en el navegador mediante `localStorage` e `IndexedDB`. Para producción web debe migrarse a backend con base de datos, autenticación real y almacenamiento de archivos.

## Datos

Los datos de `web/data/app-data.js` se generan desde las planillas originales mediante `web/scripts/generate_data.py`.

No se modifican los archivos Excel originales.
