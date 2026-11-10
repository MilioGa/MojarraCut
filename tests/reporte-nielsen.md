# Pruebas de usabilidad — 10 heurísticas de Nielsen

Fecha: 2026-11-09T20:53:28.443Z · Resultado: **47/47** comprobaciones superadas

## ✅ 1. Visibilidad del estado del sistema (5/5)

- ✔ Indicador de guardado pasa de “Guardando…” a “Guardado” — “Guardando…” → “Guardado”
- ✔ El código de tiempo refleja la posición del cursor — 00:02.50
- ✔ La selección se resalta en el timeline y en Propiedades — Clip · Imagen
- ✔ Se muestra el estado de conexión con Claude — Claude conectado
- ✔ La animación sigue la palabra que se escucha — palabra activa correcta y exportación karaoke

## ✅ 2. Relación con el mundo real (3/3)

- ✔ Vocabulario de edición en español (Cortar, Línea de tiempo, Exportar, Subtítulo) — Cortar, Línea de tiempo, Exportar, Subtítulo, Medios, Propiedades
- ✔ Formatos nombrados por plataforma (YouTube, TikTok…) — Selector de formato del proyecto
- ✔ Tiempos en formato mm:ss.cc y duraciones en segundos — 00:05.00

## ✅ 3. Control y libertad del usuario (6/6)

- ✔ Deshacer revierte una acción y Rehacer la restaura — 1 → 2 → deshacer 1 → rehacer 2
- ✔ Esc cierra los diálogos
- ✔ Eliminar un clip ofrece “Deshacer” en el aviso — DeshechoRehacer
- ✔ La exportación tiene botón para cancelar
- ✔ Siempre se puede volver al menú de proyectos
- ✔ Se puede ocultar una ventana y volver a mostrarla — Medios oculto → restablecido

## ✅ 4. Consistencia y estándares (5/5)

- ✔ Todos los botones de icono tienen título o etiqueta accesible — 52 botones revisados
- ✔ Iconos vectoriales consistentes (sin emojis en la interfaz) — 95 iconos SVG; 0 con emoji
- ✔ Un único estilo de botón primario visible por pantalla — Exportar
- ✔ La tecla Supr elimina cualquier tipo de selección (clip/pista) — Pista vacía eliminada con Supr
- ✔ Clic derecho en encabezado de pista ofrece Eliminar

## ✅ 5. Prevención de errores (4/4)

- ✔ Impide solapar clips en la misma pista —   Se solaparía con otro clip
- ✔ Pide confirmación antes de borrar una pista con clips — Diálogo de confirmación mostrado; la pista sigue intacta
- ✔ Acciones no aplicables aparecen deshabilitadas — Duplicar / Eliminar / Transición sin selección
- ✔ Valores numéricos fuera de rango se corrigen al límite — fundido=5 (máx 5)

## ✅ 6. Reconocer antes que recordar (6/6)

- ✔ Las herramientas muestran su atajo en el tooltip — 6 herramientas con atajo visible
- ✔ Los medios muestran miniatura, tipo y duración —   Imagen: 640×360 ·   Audio: 00:03.00
- ✔ Propiedades contextuales según lo seleccionado — Imagen → Recorte/Transición; medio → Información
- ✔ Las transiciones se eligen viendo una vista previa visual — 9 opciones con miniatura
- ✔ Carpetas en el panel de medios — carpeta creada desde el diálogo
- ✔ Galería visual de diseños de subtítulo (reconocer, no recordar) — 9 diseños; elegido Karaoke

## ✅ 7. Flexibilidad y eficiencia de uso (7/7)

- ✔ Atajo S corta el clip bajo el cursor — 3 → 4 clips
- ✔ Los paneles se pueden redimensionar — 260px → 320px
- ✔ Los paneles se pueden intercambiar arrastrando su título — props / viewer / media / timeline
- ✔ Las pistas se reordenan arrastrando el asa — 1ª pista: v2 → t1
- ✔ Atajo T crea un subtítulo y Ctrl+D duplica — 4 → 6
- ✔ Copiar y pegar (Ctrl+C / Ctrl+V) duplica la selección — pegado y deshecho
- ✔ Ctrl+A selecciona todos los clips

## ✅ 8. Diseño estético y minimalista (3/3)

- ✔ Clips de audio no muestran opciones visuales irrelevantes — Audio: solo Tiempo, Audio y Acciones
- ✔ Sin desbordamiento horizontal de la ventana — 1440px / 1440px
- ✔ Barra superior con pocas acciones (≤ 10 controles visibles) — 8 controles

## ✅ 9. Ayudar a reconocer y recuperarse de errores (4/4)

- ✔ Los errores del motor se muestran en lenguaje claro — El proyecto no existe
- ✔ Entrada inválida explica qué hacer y no rompe el valor —   “Duración (s)” necesita un número
- ✔ Los avisos de error se distinguen visualmente — Aviso con estilo de error e icono
- ✔ Borrar un proyecto es recuperable (papelera + Deshacer) — Eliminado → restaurado desde la papelera

## ✅ 10. Ayuda y documentación (4/4)

- ✔ La tecla ? abre la ayuda con la lista de atajos — 17 atajos documentados
- ✔ Estados vacíos con instrucciones — Medios vacíos y visor vacío explican qué hacer
- ✔ Propiedades del proyecto explican cómo trabajar con Claude
- ✔ Ayuda accesible desde el menú de proyectos
