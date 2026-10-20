/**
 * Marcadar · Radar de Marcas — Worker API
 * Asopiel · Piel de Ubrique
 *
 * Bindings requeridos:
 *   MARCADAR_DB   → D1 database "marcadar-db"
 *
 * Variables de entorno (secrets):
 *   CLAUDE_API_KEY     → Anthropic API key para rastreo IA y generación de mails
 *   RESEND_API_KEY     → Resend API key para envío de mails
 *   ADMIN_PASSWORD     → Contraseña de acceso al panel
 *   FROM_EMAIL         → Email de envío (ej: marcas@asopiel.es)
 *   FROM_NAME          → Nombre remitente (ej: Asopiel · Piel de Ubrique)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

// ─── Auth simple (admin único) ─────────────────────────────────────────────

function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === env.ADMIN_PASSWORD;
}

// ─── IA: rastreo de marca ──────────────────────────────────────────────────

async function rastrearMarca(url_o_nombre, env) {
  const prompt = `Eres un analista de mercado especializado en moda, complementos y marroquinería de lujo y premium.
Dado el siguiente sitio web o nombre de marca: "${url_o_nombre}"

Busca y extrae la siguiente información sobre esta marca. Si no encuentras algún dato, devuelve null para ese campo.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "nombre": "Nombre oficial de la marca",
  "web": "URL del sitio web oficial (con https://)",
  "pais": "País donde tiene su sede principal (en español)",
  "idioma": "Código ISO 639-1 del idioma principal de la marca (es/en/fr/it/de/ar/zh/pt/ja/ko/nl/ru)",
  "segmento": "luxury | premium | mid-market | mass-market",
  "precio_medio_bolso": 150.00,
  "facturacion_estimada": "< 1M€ | 1-10M€ | 10-50M€ | 50-200M€ | > 200M€",
  "lugar_fabricacion": "País o ciudad donde fabrican principalmente sus productos",
  "instagram": "URL completa del perfil de Instagram o null",
  "facebook": "URL completa del perfil de Facebook o null",
  "tiktok": "URL completa del perfil de TikTok o null",
  "linkedin": "URL completa del perfil de LinkedIn o null",
  "email_contacto": "Email de contacto general/corporativo (info@, contacto@, etc) o null",
  "telefono": "Teléfono de contacto o null",
  "descripcion": "Descripción breve de la marca en 2-3 frases (en español)",
  "notas": "Observaciones relevantes para contactarles desde una empresa de marroquinería artesanal española"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Error API Claude: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  // Extraer JSON de la respuesta
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('La IA no devolvió JSON válido');

  return JSON.parse(jsonMatch[0]);
}

// ─── IA: generación de mail de contacto ───────────────────────────────────

const PLANTILLA_ASOPIEL = {
  es: {
    asunto: 'Asopiel · Marroquinería artesanal de Ubrique para {nombre}',
    intro: 'Somos Asopiel, la asociación empresarial que representa a los fabricantes de marroquinería artesanal de Ubrique (España), una ciudad con más de 200 años de tradición en la fabricación de artículos de piel de alta gama.',
  },
  en: {
    asunto: 'Asopiel · Premium Leather Goods Manufacturing for {nombre}',
    intro: 'We are Asopiel, the business association representing the artisanal leather goods manufacturers of Ubrique (Spain), a city with over 200 years of tradition in crafting premium leather products.',
  },
  fr: {
    asunto: 'Asopiel · Maroquinerie artisanale d\'Ubrique pour {nombre}',
    intro: 'Nous sommes Asopiel, l\'association professionnelle représentant les fabricants de maroquinerie artisanale d\'Ubrique (Espagne), une ville avec plus de 200 ans de tradition dans la fabrication d\'articles en cuir haut de gamme.',
  },
  it: {
    asunto: 'Asopiel · Pelletteria artigianale di Ubrique per {nombre}',
    intro: 'Siamo Asopiel, l\'associazione imprenditoriale che rappresenta i produttori di pelletteria artigianale di Ubrique (Spagna), una città con oltre 200 anni di tradizione nella produzione di articoli in pelle di alta gamma.',
  },
  de: {
    asunto: 'Asopiel · Handgemachte Lederwaren aus Ubrique für {nombre}',
    intro: 'Wir sind Asopiel, der Wirtschaftsverband, der die handwerklichen Lederwarenhersteller aus Ubrique (Spanien) vertritt, einer Stadt mit über 200 Jahren Tradition in der Herstellung hochwertiger Lederprodukte.',
  },
  pt: {
    asunto: 'Asopiel · Marroquinaria artesanal de Ubrique para {nombre}',
    intro: 'Somos a Asopiel, a associação empresarial que representa os fabricantes de marroquinaria artesanal de Ubrique (Espanha), uma cidade com mais de 200 anos de tradição na produção de artigos de couro de alta qualidade.',
  },
};

async function generarMail(marca, env) {
  const idioma = marca.idioma || 'es';
  const plantilla = PLANTILLA_ASOPIEL[idioma] || PLANTILLA_ASOPIEL['en'];

  const prompt = `Eres el equipo de comunicación de Asopiel, la asociación de empresarios del sector de la piel de Ubrique (España).
Debes redactar un email de primer contacto profesional y personalizado para la marca "${marca.nombre}" en idioma con código "${idioma}".

Información disponible sobre la marca:
- País: ${marca.pais || 'desconocido'}
- Segmento: ${marca.segmento || 'premium'}
- Precio medio bolso: ${marca.precio_medio_bolso ? `${marca.precio_medio_bolso}€` : 'no disponible'}
- Lugar de fabricación actual: ${marca.lugar_fabricacion || 'no disponible'}
- Descripción: ${marca.descripcion || ''}
- Notas: ${marca.notas || ''}

Introducción institucional a usar (no cambies este texto):
"${plantilla.intro}"

El email debe:
1. Usar ese párrafo de introducción institucional
2. Mencionar brevemente qué ofrece el ecosistema de Ubrique (calidad artesanal, confidencialidad, capacidad productiva, cadena de valor completa)
3. Personalizar según el segmento y origen de fabricación de la marca
4. Proponer una llamada o reunión breve para explorar sinergias
5. Ser profesional pero cercano, NO genérico ni excesivamente formal
6. Longitud: máximo 4 párrafos
7. NO incluir asunto, firma ni despedida formal — solo el cuerpo del email

Responde ÚNICAMENTE con el cuerpo del email, sin asunto ni firma.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Error API Claude: ${response.status}`);

  const data = await response.json();
  const cuerpo = data.content[0].text.trim();
  const asunto = plantilla.asunto.replace('{nombre}', marca.nombre);

  return { asunto, cuerpo, idioma };
}

// ─── Envío de mail via Resend ──────────────────────────────────────────────

async function enviarMail(marca, mail, env) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
      to: [marca.email_contacto],
      subject: mail.asunto,
      text: mail.cuerpo,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Error Resend: ${err}`);
  }

  return await response.json();
}

// ─── Router principal ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    // ── Auth ──────────────────────────────────────────────────────────────
    if (path === '/login' && method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (password === env.ADMIN_PASSWORD) {
        return jsonResponse({ ok: true, token: env.ADMIN_PASSWORD });
      }
      return errorResponse('Contraseña incorrecta', 401);
    }

    // Todos los demás endpoints requieren auth
    if (!authenticate(request, env)) {
      return errorResponse('No autenticado', 401);
    }

    // ── Estadísticas ──────────────────────────────────────────────────────
    if (path === '/stats' && method === 'GET') {
      const stats = await env.MARCADAR_DB.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN estado = 'rastreada' THEN 1 ELSE 0 END) as rastreadas,
          SUM(CASE WHEN aprobada_contacto = 1 THEN 1 ELSE 0 END) as aprobadas,
          SUM(CASE WHEN mail_enviado = 1 THEN 1 ELSE 0 END) as contactadas,
          COUNT(DISTINCT pais) as paises
        FROM marcas
      `).first();
      return jsonResponse({ ok: true, data: stats });
    }

    // ── Marcas: listar ────────────────────────────────────────────────────
    if (path === '/marcas' && method === 'GET') {
      const estado = url.searchParams.get('estado');
      const pais = url.searchParams.get('pais');
      const aprobada = url.searchParams.get('aprobada');

      let sql = 'SELECT * FROM marcas WHERE 1=1';
      const params = [];

      if (estado) { sql += ' AND estado = ?'; params.push(estado); }
      if (pais) { sql += ' AND pais = ?'; params.push(pais); }
      if (aprobada !== null) { sql += ' AND aprobada_contacto = ?'; params.push(aprobada === '1' ? 1 : 0); }

      sql += ' ORDER BY created_at DESC';

      const { results } = await env.MARCADAR_DB.prepare(sql).bind(...params).all();
      return jsonResponse({ ok: true, data: results });
    }

    // ── Marcas: rastrear nueva ────────────────────────────────────────────
    if (path === '/marcas/rastrear' && method === 'POST') {
      const { url_o_nombre } = await request.json().catch(() => ({}));
      if (!url_o_nombre) return errorResponse('url_o_nombre es requerido');

      let ficha;
      try {
        ficha = await rastrearMarca(url_o_nombre, env);
      } catch (e) {
        return errorResponse(`Error en rastreo: ${e.message}`, 500);
      }

      const id = crypto.randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      await env.MARCADAR_DB.prepare(`
        INSERT INTO marcas (id, nombre, web, pais, idioma, segmento, precio_medio_bolso,
          facturacion_estimada, lugar_fabricacion, instagram, facebook, tiktok, linkedin,
          email_contacto, telefono, descripcion, notas, estado, fuente_rastreo, rastreada_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rastreada', ?, ?)
      `).bind(
        id, ficha.nombre, ficha.web, ficha.pais, ficha.idioma, ficha.segmento,
        ficha.precio_medio_bolso, ficha.facturacion_estimada, ficha.lugar_fabricacion,
        ficha.instagram, ficha.facebook, ficha.tiktok, ficha.linkedin,
        ficha.email_contacto, ficha.telefono, ficha.descripcion, ficha.notas,
        url_o_nombre, now
      ).run();

      // Guardar rastreo en historial
      await env.MARCADAR_DB.prepare(`
        INSERT INTO rastreos (id, marca_id, url_origen, datos_raw, modelo_ia)
        VALUES (?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID().slice(0, 8), id, url_o_nombre, JSON.stringify(ficha), 'claude-opus-4-5').run();

      return jsonResponse({ ok: true, id, data: ficha }, 201);
    }

    // ── Marcas: obtener una ───────────────────────────────────────────────
    const marcaMatch = path.match(/^\/marcas\/([^/]+)$/);
    if (marcaMatch && method === 'GET') {
      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?')
        .bind(marcaMatch[1]).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);
      return jsonResponse({ ok: true, data: marca });
    }

    // ── Marcas: actualizar ────────────────────────────────────────────────
    if (marcaMatch && method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!body) return errorResponse('Body inválido');

      const campos = ['nombre','web','pais','idioma','segmento','precio_medio_bolso',
        'facturacion_estimada','lugar_fabricacion','instagram','facebook','tiktok','linkedin',
        'email_contacto','telefono','descripcion','notas','estado'];

      const sets = [];
      const vals = [];
      for (const c of campos) {
        if (c in body) { sets.push(`${c} = ?`); vals.push(body[c]); }
      }
      if (!sets.length) return errorResponse('Sin campos a actualizar');

      sets.push('updated_at = ?');
      vals.push(new Date().toISOString());
      vals.push(marcaMatch[1]);

      await env.MARCADAR_DB.prepare(`UPDATE marcas SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals).run();

      return jsonResponse({ ok: true });
    }

    // ── Marcas: eliminar ──────────────────────────────────────────────────
    if (marcaMatch && method === 'DELETE') {
      await env.MARCADAR_DB.prepare('DELETE FROM marcas WHERE id = ?').bind(marcaMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── Marcas: aprobar para contacto ─────────────────────────────────────
    const aprobarMatch = path.match(/^\/marcas\/([^/]+)\/aprobar$/);
    if (aprobarMatch && method === 'POST') {
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET aprobada_contacto = 1, aprobada_at = ?, updated_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), new Date().toISOString(), aprobarMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── Marcas: desaprobar ────────────────────────────────────────────────
    const desaprobarMatch = path.match(/^\/marcas\/([^/]+)\/desaprobar$/);
    if (desaprobarMatch && method === 'POST') {
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET aprobada_contacto = 0, aprobada_at = null, updated_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), desaprobarMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── Mails: generar borrador ───────────────────────────────────────────
    const generarMailMatch = path.match(/^\/marcas\/([^/]+)\/mail\/generar$/);
    if (generarMailMatch && method === 'POST') {
      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?')
        .bind(generarMailMatch[1]).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);
      if (!marca.aprobada_contacto) return errorResponse('La marca no está aprobada para contacto', 403);
      if (!marca.email_contacto) return errorResponse('La marca no tiene email de contacto', 422);

      let mail;
      try {
        mail = await generarMail(marca, env);
      } catch (e) {
        return errorResponse(`Error generando mail: ${e.message}`, 500);
      }

      // Guardar borrador
      const mailId = crypto.randomUUID().slice(0, 8);
      await env.MARCADAR_DB.prepare(`
        INSERT INTO mails (id, marca_id, idioma, asunto, cuerpo, estado)
        VALUES (?, ?, ?, ?, ?, 'borrador')
      `).bind(mailId, generarMailMatch[1], mail.idioma, mail.asunto, mail.cuerpo).run();

      return jsonResponse({ ok: true, mail_id: mailId, data: mail });
    }

    // ── Mails: enviar ─────────────────────────────────────────────────────
    const enviarMailMatch = path.match(/^\/mails\/([^/]+)\/enviar$/);
    if (enviarMailMatch && method === 'POST') {
      const mailRec = await env.MARCADAR_DB.prepare('SELECT * FROM mails WHERE id = ?')
        .bind(enviarMailMatch[1]).first();
      if (!mailRec) return errorResponse('Mail no encontrado', 404);
      if (mailRec.estado === 'enviado') return errorResponse('Este mail ya fue enviado', 409);

      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?')
        .bind(mailRec.marca_id).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);

      let resultado;
      try {
        resultado = await enviarMail(marca, mailRec, env);
      } catch (e) {
        return errorResponse(`Error enviando mail: ${e.message}`, 500);
      }

      const now = new Date().toISOString();

      await env.MARCADAR_DB.prepare(`
        UPDATE mails SET estado = 'enviado', enviado_at = ?, message_id_externo = ?, proveedor_envio = 'resend'
        WHERE id = ?
      `).bind(now, resultado.id || null, enviarMailMatch[1]).run();

      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET mail_enviado = 1, mail_enviado_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, mailRec.marca_id).run();

      return jsonResponse({ ok: true, message_id: resultado.id });
    }

    // ── Mails: listar por marca ───────────────────────────────────────────
    const mailsMarcaMatch = path.match(/^\/marcas\/([^/]+)\/mails$/);
    if (mailsMarcaMatch && method === 'GET') {
      const { results } = await env.MARCADAR_DB.prepare(
        'SELECT * FROM mails WHERE marca_id = ? ORDER BY generado_at DESC'
      ).bind(mailsMarcaMatch[1]).all();
      return jsonResponse({ ok: true, data: results });
    }

    return errorResponse('Ruta no encontrada', 404);
  },
};
