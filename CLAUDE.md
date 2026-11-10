# MojarraCut — editor de video asistido por Claude

Datos del usuario: `Documentos\MojarraCut\` (o `OneDrive\Documentos\MojarraCut\`).
```
proyectos\<id>\project.json   ← lo que editas
proyectos\<id>\media\         ← videos, imágenes y audio del proyecto
proyectos\<id>\exports\       ← MP4 exportados
proyectos\<id>\medios.json    ← índice de medios: duración, tamaño, si tiene audio, transcripción (lo genera la app)
proyectos\<id>\transcripciones\<medio>.txt ← lo que se dice, por frases: "inicio-fin texto" (segundos del archivo)
activo.txt                    ← id del proyecto abierto ahora en la app
papelera\                     ← proyectos borrados (recuperables)
```
Cuando el usuario pida "haz / edita un video", edita el `project.json` del proyecto **activo** (lee `activo.txt`;
si está vacío, pregunta cuál o crea una carpeta nueva en `proyectos\` con `media\` y `exports\`).
La app detecta el cambio al instante; el usuario puede deshacerlo con Ctrl+Z o corregirlo a mano.

## Flujo (barato: no hace falta ffprobe ni mirar el video)
1. Lee `medios.json` (una línea por medio con duración/tamaño). Si copias medios nuevos a `media\`, la app lo actualiza en ~1 s.
2. Para editar por lo que se dice ("quita donde digo X", "corta las pausas"), lee `transcripciones\<medio>.txt`.
   Si no existe y la app está abierta: `curl -X POST "http://localhost:5173/api/transcribe?name=<medio>&lang=es&mode=local"`
   (estado: `GET /api/transcribe`). Si responde que falta un modelo, pide al usuario que descargue uno desde la app
   (clic derecho en el clip → Crear subtítulos desde la voz). Detalle por palabra: `transcripciones\<medio>.json` (`words`: t, s, e).
3. Lee `project.json` y cámbialo. Para cambios pequeños edita solo el fragmento; para un montaje nuevo escríbelo completo (JSON válido, UTF-8).
4. No verifiques extrayendo fotogramas salvo que el usuario lo pida: él lo ve al instante en la app.
5. Exportar MP4 del proyecto activo: `curl -X POST http://localhost:5173/api/render` (estado: `GET` misma URL).

## Esquema
```jsonc
{
  "name": "Mi video", "width": 1920, "height": 1080, "fps": 30, "background": "#000000",
  "tracks": [                       // orden = de arriba a abajo; la primera pista visual se dibuja ENCIMA
    { "id": "v1", "type": "video", "name": "Video 1", "hidden": false, "muted": false, "locked": false,
      "clips": [
        { "id": "c1", "src": "clip.mp4",   // archivo en media/ (video o imagen)
          "start": 0, "in": 2.5, "duration": 4,   // segundos (timeline / dentro del archivo / largo)
          "volume": 1, "muted": false,            // volumen 0–2
          "scale": 1, "x": 0, "y": 0, "opacity": 1, "fadeIn": 0.5, "fadeOut": 0.5,
          "crop": { "l": 0.1, "t": 0, "r": 0.1, "b": 0 },          // recorte en fracciones 0–0.9 (opcional)
          "transition": { "type": "dissolve", "duration": 1 } }  // cómo ENTRA este clip (opcional)
      ] },
    { "id": "t1", "type": "text", "name": "Subtítulos",
      "clips": [ { "id": "s1", "start": 0, "duration": 2.5, "text": "Hola\nsegunda línea", "x": 0, "y": 0,
        "style": { "fontSize": 64, "color": "#ffffff", "position": "bottom|center|top",
                   "bold": true, "outline": 3, "background": "#000000", "backgroundOpacity": 0.6 } } ] },
    { "id": "a1", "type": "audio", "name": "Música",
      "clips": [ { "id": "m1", "src": "musica.mp3", "start": 0, "in": 0, "duration": 30, "volume": 0.3, "fadeIn": 1, "fadeOut": 2 } ] }
  ]
}
```

## Transiciones
`transition.type`: `dissolve`, `black`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `push-left`, `push-right`.
Solo en pistas `video`. Si el clip va pegado al anterior de la misma pista (anterior.start+duration == start),
se mezclan: el anterior se prolonga `duration` s por debajo. No hace falta solapar clips.

## Extras (v1.2)
- Clips de video/imagen/texto: `"effects": [{ "type": "grayscale|sepia|invert|blur|brightness|contrast|saturate|hue", "amount": 0.8, "enabled": true }]`
  (`amount` 0–1, salvo blur en px, brightness/contrast/saturate 0–3, hue en grados).
- Audio de un clip: `audioFadeIn` / `audioFadeOut` (s). Si faltan se usan `fadeIn` / `fadeOut`.
- Carpetas del panel de medios: `"bin": { "folders": [{ "id": "f1", "name": "Tomas", "parent": null }], "map": { "clip.mp4": "f1" } }` (solo organización).

## Subtítulos con diseño y animación por palabra
Clip de texto: `"style": { "preset": "impacto", "font": "Impact", "fontSize": 92, "color": "#ffffff", "uppercase": true,
"outline": 6, "outlineColor": "#000000", "shadow": 0, "glow": 0, "highlight": "#39ff6a", "anim": "pop", "position": "bottom" }`
y opcional `"words": [{ "s": 0, "e": 0.4 }, …]` = inicio/fin de cada palabra del `text`, en segundos desde el inicio del clip
(misma cantidad que palabras; si no coincide, la app reparte los tiempos por la duración).
- `preset`: clasico, caja, impacto, karaoke, marcador, neon, aparecer, tv, minimal (basta con copiar sus valores; la app los muestra).
- `anim`: none, highlight (palabra actual en color), pop (crece), karaoke (relleno), marker (fondo de color), reveal (aparecen al decirse).
- `font`: Arial, Arial Black, Impact, Segoe UI, Verdana, Trebuchet MS, Georgia, Comic Sans MS, Courier New.
- Subtítulos desde una transcripción: una frase de `.json` → `phrases[i]` = un clip; `start` = clip_audio.start + (frase.s − clip_audio.in);
  `words` = cada palabra con s/e restando frase.s. Frases de ≤ 32 caracteres y ≤ 3.2 s.

## Reglas
- Pistas `video` aceptan videos e imágenes; `audio` solo audio; `text` solo textos.
- Los clips de una misma pista **no deben solaparse** (usa otra pista para superponer).
- Ids únicos. `in + duration` ≤ duración del archivo.
- Formatos: 1920x1080 (YouTube), 1080x1920 (Shorts/Reels/TikTok), 1080x1080, 3840x2160.
- Si una instrucción es ambigua, haz tu mejor versión y di qué decidiste; el usuario lo ajusta en la app.
