-- Marcadar · Base de datos D1
-- database_id: 2abb9cb7-b53f-46d5-97ac-8e35165e5b49

CREATE TABLE IF NOT EXISTS marcas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  web TEXT,
  pais TEXT,
  idioma TEXT DEFAULT 'es',
  segmento TEXT,
  clasificacion_contacto TEXT, -- lujo | premium | nueva
  precio_medio_bolso REAL,
  facturacion_estimada TEXT,
  lugar_fabricacion TEXT,
  instagram TEXT,
  facebook TEXT,
  tiktok TEXT,
  linkedin TEXT,
  email_contacto TEXT,
  telefono TEXT,
  descripcion TEXT,
  notas TEXT,
  estado TEXT DEFAULT 'rastreada',
  fuente_rastreo TEXT,
  rastreada_at TEXT,
  aprobada_contacto INTEGER DEFAULT 0,
  aprobada_at TEXT,
  mail_enviado INTEGER DEFAULT 0,
  mail_enviado_at TEXT,
  mail_respuesta TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rastreos (
  id TEXT PRIMARY KEY,
  marca_id TEXT NOT NULL,
  url_origen TEXT,
  datos_raw TEXT,
  modelo_ia TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mails (
  id TEXT PRIMARY KEY,
  marca_id TEXT NOT NULL,
  idioma TEXT NOT NULL,
  asunto TEXT,
  cuerpo TEXT NOT NULL,
  generado_at TEXT DEFAULT (datetime('now')),
  enviado_at TEXT,
  estado TEXT DEFAULT 'borrador',
  proveedor_envio TEXT,
  message_id_externo TEXT,
  FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marcas_estado ON marcas(estado);
CREATE INDEX IF NOT EXISTS idx_marcas_pais ON marcas(pais);
CREATE INDEX IF NOT EXISTS idx_marcas_aprobada ON marcas(aprobada_contacto);
CREATE INDEX IF NOT EXISTS idx_mails_marca ON mails(marca_id);
CREATE INDEX IF NOT EXISTS idx_rastreos_marca ON rastreos(marca_id);
