// Marcadar · Worker API — Asopiel
// Cloudflare Worker con D1 database

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status);
}

function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === env.ADMIN_PASSWORD;
}

// ─── HASH CLAVE ASOCIADO ──────────────────────────────────────────────────────
async function hashClave(clave) {
  const encoder = new TextEncoder();
  const data = encoder.encode(clave);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── NORMALIZACIÓN DE NOMBRES/DOMINIOS ────────────────────────────────────────
function normalizarNombre(nombre) {
  return nombre.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizarDominio(web) {
  if (!web) return null;
  try {
    const url = web.startsWith('http') ? new URL(web) : new URL('https://' + web);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return web.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

// ─── OBTENER LISTA DE MARCAS BLOQUEADAS ───────────────────────────────────────
async function getMarcasBloqueadas(env) {
  const { results } = await env.MARCADAR_DB.prepare(
    'SELECT nombre_norm, web_dominio FROM marcas_bloqueadas'
  ).all();
  return results || [];
}

// ─── COMPROBAR SI UNA MARCA ESTÁ BLOQUEADA ────────────────────────────────────
function estaBloqueada(ficha, listaNegra) {
  const nombreNorm = normalizarNombre(ficha.nombre || '');
  const dominio = normalizarDominio(ficha.web);

  for (const b of listaNegra) {
    if (b.nombre_norm && b.nombre_norm === nombreNorm) return true;
    if (dominio && b.web_dominio && b.web_dominio === dominio) return true;
  }
  return false;
}

// ─── PAÍSES EN ROTACIÓN ────────────────────────────────────────────────────
const PAISES_ROTACION = ['España', 'Francia', 'Reino Unido'];

function getPaisDelDia() {
  const hoy = new Date();
  const diaDelAno = Math.floor((hoy - new Date(hoy.getFullYear(), 0, 0)) / 86400000);
  return PAISES_ROTACION[diaDelAno % PAISES_ROTACION.length];
}

// ─── BÚSQUEDA AUTÓNOMA POR PAÍS ────────────────────────────────────────────
async function buscarMarcasPorPais(pais, marcasDescartadas, listaNegra, env) {
  const motivosCtx = marcasDescartadas.length > 0
    ? `\n\nMarcas ya descartadas anteriormente (NO las repitas): ${marcasDescartadas.map(m => m.nombre).join(', ')}.`
    : '';

  // Instrucciones específicas para mercados asiáticos
  let criteriosEspeciales = '';
  if (pais === 'China') {
    criteriosEspeciales = `
Instrucciones específicas para China:
- Busca marcas chinas de moda, lifestyle y complementos que usen o puedan usar artículos de piel
- Incluye tanto marcas que fabrican en China como marcas que ya producen total o parcialmente fuera (Italia, Francia, etc.)
- Prioriza marcas con presencia internacional o aspiraciones globales
- Incluye marcas de lujo chinas emergentes, marcas premium urbanas y marcas con heritage artesanal
- No limites la búsqueda solo a marcas que actualmente fabriquen fuera de China`;
  } else if (pais === 'Japón') {
    criteriosEspeciales = `
Instrucciones específicas para Japón:
- Busca marcas japonesas que valoren la artesanía, la calidad de los materiales y el detalle en el acabado
- Incluye marcas de moda japonesa con influencia en el mercado global, marcas de accesorios premium y marcas lifestyle
- El mercado japonés aprecia especialmente la transparencia en la cadena de producción y el origen artesanal
- Incluye marcas tradicionales japonesas que buscan credenciales artesanales europeas y marcas contemporáneas`;
  }

  const prompt = `Eres un analista experto en moda, marroquinería y complementos de lujo y premium.

Tu tarea: identificar exactamente 10 marcas de ${pais} que podrían estar interesadas en fabricar sus artículos de marroquinería (bolsos, carteras, cinturones, complementos de piel) en Ubrique, España — el principal ecosistema artesanal de marroquinería de Europa.

Criterios de selección:
- Marcas de moda, lifestyle, lujo, premium o mid-market que usen o puedan usar artículos de piel
- Que actualmente no fabriquen en Ubrique (o que no sea su proveedor principal conocido)
- Mezcla de marcas establecidas y marcas emergentes con potencial
- Segmentos: luxury, premium, mid-market (no mass-market ni fast fashion)${criteriosEspeciales}${motivosCtx}

Para cada marca, devuelve un objeto JSON con esta estructura exacta:
{
  "nombre": "Nombre oficial",
  "web": "https://...",
  "pais": "${pais}",
  "idioma": "código ISO 639-1 (es/en/fr/it/de/pt/zh/ja/etc)",
  "segmento": "luxury | premium | mid-market",
  "clasificacion_contacto": "lujo | premium | nueva",
  "precio_medio_bolso": número en euros o null,
  "facturacion_estimada": "< 1M€ | 1-10M€ | 10-50M€ | 50-200M€ | > 200M€",
  "lugar_fabricacion": "país o ciudad actual de fabricación o null",
  "instagram": "URL completa o null",
  "facebook": "URL completa o null",
  "tiktok": "URL completa o null",
  "linkedin": "URL completa o null",
  "email_contacto": "email corporativo genérico (info@, contact@, etc) o null",
  "telefono": null,
  "descripcion": "2-3 frases sobre la marca en español",
  "notas": "por qué podría interesarle fabricar en Ubrique"
}

El campo "clasificacion_contacto" usa estos criterios:
- "lujo": marcas heritage o de lujo consolidado (> 200€ precio medio bolso o facturación > 50M€)
- "premium": marcas premium en crecimiento (50-200€ precio medio o facturación 10-50M€)
- "nueva": marcas emergentes o pequeñas con potencial (< 50€ precio medio o < 10M€ facturación)

Responde ÚNICAMENTE con un array JSON válido de exactamente 10 objetos. Sin texto adicional.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Error API Claude: ${response.status}`);
  const data = await response.json();
  const text = data.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('La IA no devolvió JSON válido');
  const marcas = JSON.parse(jsonMatch[0]);

  // Filtrar marcas bloqueadas
  return marcas.filter(m => !estaBloqueada(m, listaNegra));
}

// ─── RASTREO DE MARCA CONCRETA ─────────────────────────────────────────────
async function rastrearMarca(url_o_nombre, env) {
  const prompt = `Eres un analista de mercado especializado en moda, complementos y marroquinería de lujo y premium.
Dado el siguiente sitio web o nombre de marca: "${url_o_nombre}"

Busca y extrae la siguiente información sobre esta marca. Si no encuentras algún dato, devuelve null para ese campo.

El campo "clasificacion_contacto" usa estos criterios:
- "lujo": marcas heritage o de lujo consolidado (> 200€ precio medio bolso o facturación > 50M€)
- "premium": marcas premium en crecimiento (50-200€ precio medio o facturación 10-50M€)
- "nueva": marcas emergentes o pequeñas con potencial (< 50€ precio medio o < 10M€ facturación)

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "nombre": "Nombre oficial de la marca",
  "web": "URL del sitio web oficial (con https://)",
  "pais": "País donde tiene su sede principal (en español)",
  "idioma": "Código ISO 639-1 del idioma principal de la marca",
  "segmento": "luxury | premium | mid-market | mass-market",
  "clasificacion_contacto": "lujo | premium | nueva",
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
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Error API Claude: ${response.status}`);
  const data = await response.json();
  const text = data.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('La IA no devolvió JSON válido');
  return JSON.parse(jsonMatch[0]);
}

// ─── PLANTILLAS DE CORREO ──────────────────────────────────────────────────
const FIRMA = `

--
Antonio L. Ardila Jaén
Gerente — Asopiel
gerencia@asopiel.com
www.asopiel.com`;

const PLANTILLAS = {
  lujo: {
    es: {
      asunto: 'Ubrique · Fabricación artesanal de marroquinería para {nombre}',
      intro: `Nos dirigimos a ustedes desde Asopiel, la asociación empresarial que representa a los fabricantes de marroquinería artesanal de Ubrique (España).

Ubrique alberga uno de los ecosistemas productivos más singulares del mundo: cerca de 200 empresas que cubren toda la cadena de valor de la marroquinería, desde proveedores de pieles y herrajes hasta empresas especializadas en corte, rebajado, grabado, timbrado y packaging. Un ecosistema completo, en un solo lugar.

Desde Asopiel actuamos como punto de conexión entre marcas internacionales y nuestros asociados, facilitando el desarrollo de producto con los más altos estándares de calidad artesanal y la confidencialidad que requieren los proyectos de alto nivel.

Nos gustaría explorar si existe alguna sinergia entre {nombre} y el talento productivo de Ubrique. ¿Tendría sentido una conversación breve en las próximas semanas?`
    },
    en: {
      asunto: 'Ubrique · Premium Artisan Leather Goods Manufacturing for {nombre}',
      intro: `We are reaching out from Asopiel, the business association representing the artisanal leather goods manufacturers of Ubrique (Spain).

Ubrique hosts one of the most singular production ecosystems in the world: nearly 200 companies covering the entire leather goods value chain, from suppliers of hides and hardware to specialists in cutting, skiving, embossing, stamping, and packaging. A complete ecosystem, in a single location.

At Asopiel we act as the connection point between international brands and our members, facilitating product development to the highest standards of artisanal quality and with the confidentiality that high-end projects require.

We would like to explore whether there is any synergy between {nombre} and the productive talent of Ubrique. Would a brief conversation in the coming weeks make sense?`
    },
    fr: {
      asunto: 'Ubrique · Fabrication artisanale de maroquinerie pour {nombre}',
      intro: `Nous vous contactons depuis Asopiel, l'association professionnelle représentant les fabricants de maroquinerie artisanale d'Ubrique (Espagne).

Ubrique abrite l'un des écosystèmes de production les plus singuliers au monde : près de 200 entreprises couvrant toute la chaîne de valeur de la maroquinerie, des fournisseurs de peaux et de quincaillerie aux spécialistes du découpe, refente, gaufrage, estampage et emballage. Un écosystème complet, en un seul lieu.

Chez Asopiel, nous agissons comme point de connexion entre les marques internationales et nos adhérents, facilitant le développement de produits selon les plus hauts standards de qualité artisanale et avec la confidentialité qu'exigent les projets haut de gamme.

Nous souhaiterions explorer s'il existe des synergies entre {nombre} et le savoir-faire productif d'Ubrique. Serait-il possible d'avoir une brève conversation dans les prochaines semaines ?`
    },
    de: {
      asunto: 'Ubrique · Handwerkliche Lederwarenproduktion für {nombre}',
      intro: `Wir melden uns von Asopiel, dem Unternehmerverband, der die handwerklichen Lederwarenhersteller aus Ubrique (Spanien) vertritt.

Ubrique beherbergt eines der einzigartigsten Produktionsökosysteme der Welt: fast 200 Unternehmen, die die gesamte Wertschöpfungskette der Lederwarenbranche abdecken — von Leder- und Beschlaglieferanten bis hin zu Spezialisten für Zuschnitt, Spalten, Prägen, Stempeln und Verpackung. Ein vollständiges Ökosystem an einem einzigen Standort.

Asopiel fungiert als Verbindungspunkt zwischen internationalen Marken und unseren Mitgliedern und unterstützt die Produktentwicklung auf höchstem handwerklichem Qualitätsniveau — mit der Vertraulichkeit, die hochwertige Projekte erfordern.

Wir möchten gerne prüfen, ob es Synergien zwischen {nombre} und dem Produktionstalent in Ubrique gibt. Wäre ein kurzes Gespräch in den nächsten Wochen möglich?`
    },
    it: {
      asunto: 'Ubrique · Produzione artigianale di pelletteria per {nombre}',
      intro: `Vi contattamo da Asopiel, l'associazione imprenditoriale che rappresenta i produttori artigianali di pelletteria di Ubrique (Spagna).

Ubrique ospita uno degli ecosistemi produttivi più singolari al mondo: quasi 200 aziende che coprono l'intera catena del valore della pelletteria, dai fornitori di pelli e accessori agli specialisti in taglio, spaccatura, goffratura, stampaggio e packaging. Un ecosistema completo, in un unico luogo.

In Asopiel agiamo come punto di connessione tra marchi internazionali e i nostri associati, facilitando lo sviluppo di prodotto ai più alti standard di qualità artigianale e con la riservatezza che i progetti di alto livello richiedono.

Ci piacerebbe esplorare se esistono sinergie tra {nombre} e il talento produttivo di Ubrique. Avrebbe senso una breve conversazione nelle prossime settimane?`
    },
    pt: {
      asunto: 'Ubrique · Fabrico artesanal de marroquinaria para {nombre}',
      intro: `Contactamo-los desde a Asopiel, a associação empresarial que representa os fabricantes artesanais de marroquinaria de Ubrique (Espanha).

Ubrique alberga um dos ecossistemas produtivos mais singulares do mundo: cerca de 200 empresas que cobrem toda a cadeia de valor da marroquinaria, desde fornecedores de couros e ferragens até especialistas em corte, divisão, gravação e embalagem. Um ecossistema completo, num único lugar.

Na Asopiel atuamos como ponto de ligação entre marcas internacionais e os nossos associados, facilitando o desenvolvimento de produto com os mais elevados padrões de qualidade artesanal e com a confidencialidade que os projetos de alto nível exigem.

Gostaríamos de explorar se existe alguma sinergia entre {nombre} e o talento produtivo de Ubrique. Faria sentido uma breve conversa nas próximas semanas?`
    },
    zh: {
      asunto: 'Ubrique · 为{nombre}提供西班牙顶级手工皮具制造服务',
      intro: `您好，我们来自Asopiel，这是代表西班牙乌布里克（Ubrique）手工皮具制造商的行业协会。

乌布里克拥有世界上最独特的皮具生产生态系统之一：近200家企业覆盖皮具价值链的全部环节，从皮革和五金供应商到裁切、削薄、压纹、烫印和包装专业企业。一个完整的生态系统，集中在一个地方。

在Asopiel，我们充当国际品牌与会员之间的连接纽带，以最高的手工艺质量标准促进产品开发，并保持高端项目所需的保密性。

我们希望探讨{nombre}与乌布里克生产人才之间是否存在合作空间。在未来几周内进行一次简短的交流是否可行？`
    },
    ja: {
      asunto: 'Ubrique · {nombre}様への高品質レザーグッズ製造のご提案',
      intro: `スペイン・ウブリケ（Ubrique）の手工芸皮革製品メーカーを代表する業界団体、Asopielよりご連絡申し上げます。

ウブリケは、世界でも有数のユニークな皮革製品生産エコシステムを誇ります。皮革・金具サプライヤーから裁断、漉き、エンボス加工、スタンピング、パッケージングの専門企業まで、約200社がバリューチェーン全体をカバーしています。すべてが一か所に集結した完全なエコシステムです。

Asopielでは、国際ブランドと会員企業の架け橋として、最高水準の職人技術と高級プロジェクトに求められる機密性を維持しながら製品開発を支援しています。

{nombre}様とウブリケの生産力との間に何らかのシナジーがあるかどうか、ぜひ探ってみたいと考えております。近いうちに短い会話の機会をいただけますでしょうか。`
    }
  },

  premium: {
    es: {
      asunto: 'Asopiel · ¿Fabricar en Ubrique para {nombre}?',
      intro: `Somos Asopiel, la asociación de empresarios del sector de la piel de Ubrique (España), y nos ponemos en contacto porque creemos que podría existir una colaboración interesante con {nombre}.

Ubrique es posiblemente el ecosistema de marroquinería más completo de Europa: cerca de 200 empresas que cubren toda la cadena productiva —materias primas, auxiliares, fabricación y packaging— en un único entorno. Asopiel representa a más del 75% de esa capacidad y trabaja directamente con marcas que buscan fabricar en España con calidad artesanal garantizada.

Nuestra función es exactamente esa: encontrar dentro del ecosistema de Ubrique al socio ideal para cada proyecto, ya sea una colección nueva, una línea específica o una colaboración a largo plazo.

Si están evaluando opciones de fabricación o quieren conocer qué puede ofrecer Ubrique, estaremos encantados de contárselo en una llamada corta.`
    },
    en: {
      asunto: 'Asopiel · Manufacturing in Ubrique for {nombre}?',
      intro: `We are Asopiel, the business association for the leather goods sector in Ubrique (Spain), and we are reaching out because we believe there could be an interesting collaboration with {nombre}.

Ubrique is possibly the most complete leather goods ecosystem in Europe: nearly 200 companies covering the entire production chain — raw materials, auxiliary services, manufacturing and packaging — in a single location. Asopiel represents over 75% of that capacity and works directly with brands looking to manufacture in Spain with guaranteed artisanal quality.

Our role is exactly that: finding the ideal partner within the Ubrique ecosystem for each project, whether it is a new collection, a specific line or a long-term collaboration.

If you are evaluating manufacturing options or want to know what Ubrique can offer, we would be happy to discuss it in a brief call.`
    },
    fr: {
      asunto: 'Asopiel · Fabriquer à Ubrique pour {nombre} ?',
      intro: `Nous sommes Asopiel, l'association professionnelle du secteur de la maroquinerie d'Ubrique (Espagne), et nous vous contactons car nous pensons qu'une collaboration intéressante pourrait exister avec {nombre}.

Ubrique est probablement l'écosystème de maroquinerie le plus complet d'Europe : près de 200 entreprises couvrant toute la chaîne de production — matières premières, services auxiliaires, fabrication et emballage — en un seul endroit. Asopiel représente plus de 75 % de cette capacité et travaille directement avec des marques cherchant à fabriquer en Espagne avec une qualité artisanale garantie.

Notre rôle est précisément celui-là : trouver, au sein de l'écosystème d'Ubrique, le partenaire idéal pour chaque projet, qu'il s'agisse d'une nouvelle collection, d'une ligne spécifique ou d'une collaboration à long terme.

Si vous évaluez des options de fabrication ou souhaitez découvrir ce qu'Ubrique peut offrir, nous serions ravis d'en discuter lors d'un court appel.`
    },
    de: {
      asunto: 'Asopiel · Produktion in Ubrique für {nombre}?',
      intro: `Wir sind Asopiel, der Unternehmerverband des Lederwarenssektors in Ubrique (Spanien), und wir melden uns, weil wir glauben, dass es eine interessante Zusammenarbeit mit {nombre} geben könnte.

Ubrique ist möglicherweise das vollständigste Lederwarenökosystem Europas: fast 200 Unternehmen, die die gesamte Produktionskette abdecken — Rohstoffe, Hilfsbetriebe, Fertigung und Verpackung — an einem einzigen Standort. Asopiel vertritt über 75 % dieser Kapazität und arbeitet direkt mit Marken zusammen, die in Spanien mit garantierter handwerklicher Qualität produzieren möchten.

Unsere Aufgabe ist genau das: innerhalb des Ubrique-Ökosystems den idealen Partner für jedes Projekt zu finden, sei es eine neue Kollektion, eine spezifische Linie oder eine langfristige Zusammenarbeit.

Wenn Sie Fertigungsoptionen evaluieren oder erfahren möchten, was Ubrique bieten kann, sprechen wir gerne in einem kurzen Anruf darüber.`
    },
    it: {
      asunto: 'Asopiel · Produrre a Ubrique per {nombre}?',
      intro: `Siamo Asopiel, l'associazione imprenditoriale del settore pelletteria di Ubrique (Spagna), e vi contattamo perché riteniamo che potrebbe esistere una collaborazione interessante con {nombre}.

Ubrique è probabilmente l'ecosistema di pelletteria più completo d'Europa: quasi 200 aziende che coprono l'intera catena produttiva — materie prime, servizi ausiliari, produzione e packaging — in un unico luogo. Asopiel rappresenta oltre il 75% di questa capacità e lavora direttamente con marchi che cercano di produrre in Spagna con qualità artigianale garantita.

Il nostro ruolo è esattamente questo: trovare all'interno dell'ecosistema di Ubrique il partner ideale per ogni progetto, che si tratti di una nuova collezione, di una linea specifica o di una collaborazione a lungo termine.

Se state valutando opzioni di produzione o volete sapere cosa può offrire Ubrique, saremo lieti di discuterne in una breve chiamata.`
    },
    pt: {
      asunto: 'Asopiel · Fabricar em Ubrique para {nombre}?',
      intro: `Somos a Asopiel, a associação empresarial do setor da pele de Ubrique (Espanha), e entramos em contacto porque acreditamos que poderia existir uma colaboração interessante com {nombre}.

Ubrique é possivelmente o ecossistema de marroquinaria mais completo da Europa: cerca de 200 empresas que cobrem toda a cadeia produtiva — matérias-primas, serviços auxiliares, fabrico e embalagem — num único local. A Asopiel representa mais de 75% dessa capacidade e trabalha diretamente com marcas que procuram fabricar em Espanha com qualidade artesanal garantida.

A nossa função é exatamente essa: encontrar dentro do ecossistema de Ubrique o parceiro ideal para cada projeto, seja uma nova coleção, uma linha específica ou uma colaboração a longo prazo.

Se estão a avaliar opções de fabrico ou querem saber o que Ubrique pode oferecer, teremos todo o gosto em explicar numa breve chamada.`
    },
    zh: {
      asunto: 'Asopiel · {nombre}在乌布里克的制造合作机会',
      intro: `我们是Asopiel，西班牙乌布里克皮具行业的企业家协会，我们与您联系是因为相信与{nombre}可能存在有趣的合作机会。

乌布里克可能是欧洲最完整的皮具生态系统：近200家企业覆盖整个生产链——原材料、辅助服务、制造和包装——集中在一个地方。Asopiel代表了75%以上的产能，直接与寻求在西班牙以有保障的手工艺质量进行生产的品牌合作。

我们的职责正是如此：在乌布里克生态系统中为每个项目找到理想的合作伙伴，无论是新系列、特定产品线还是长期合作。

如果您正在评估制造选项或想了解乌布里克能提供什么，我们很乐意在简短的通话中进行介绍。`
    },
    ja: {
      asunto: 'Asopiel · {nombre}様のウブリケ製造パートナーシップについて',
      intro: `私どもはAsopielと申します。スペイン・ウブリケの皮革製品業界の企業家協会です。{nombre}様との有益なコラボレーションの可能性があると考え、ご連絡させていただきました。

ウブリケはおそらくヨーロッパで最も完全な皮革製品エコシステムです。原材料、補助サービス、製造、パッケージングまで、生産チェーン全体をカバーする約200社が一か所に集まっています。Asopielはその生産能力の75%以上を代表し、スペインで保証された職人品質での製造を求めるブランドと直接取り組んでいます。

私どもの役割はまさにそれです。新しいコレクション、特定のライン、または長期的なコラボレーションなど、各プロジェクトに最適なパートナーをウブリケのエコシステム内で見つけることです。

製造オプションを検討中であるか、ウブリケが提供できるものについてお知りになりたい場合は、短い通話でご説明できれば幸いです。`
    }
  },

  nueva: {
    es: {
      asunto: 'Asopiel · Desarrolla tu proyecto en Ubrique',
      intro: `Somos Asopiel, la asociación empresarial de la marroquinería de Ubrique (España), y nos ha parecido interesante conocer el proyecto de {nombre}.

En Ubrique encontrarás todo lo que necesitas para desarrollar un artículo de piel: proveedores de materias primas, empresas auxiliares especializadas (corte, grabado, timbrado, rebajado) y fabricantes con experiencia en todo tipo de artículos y acabados. Cerca de 200 empresas que forman un ecosistema único, con la ventaja de que Asopiel actúa como intermediario para que el proceso sea más ágil y directo.

Si estáis en fase de búsqueda de producción o queréis explorar qué puede ofrecer Ubrique para vuestro proyecto, estaremos encantados de hablar con vosotros.`
    },
    en: {
      asunto: 'Asopiel · Develop your project in Ubrique',
      intro: `We are Asopiel, the leather goods business association of Ubrique (Spain), and we found your project at {nombre} interesting.

In Ubrique you will find everything you need to develop a leather goods product: raw material suppliers, specialized auxiliary companies (cutting, embossing, stamping, skiving) and manufacturers experienced in all types of items and finishes. Nearly 200 companies forming a unique ecosystem, with the added advantage that Asopiel acts as an intermediary to make the process more agile and direct.

If you are in the production search phase or want to explore what Ubrique can offer your project, we would love to speak with you.`
    },
    fr: {
      asunto: 'Asopiel · Développez votre projet à Ubrique',
      intro: `Nous sommes Asopiel, l'association professionnelle de la maroquinerie d'Ubrique (Espagne), et nous avons trouvé le projet de {nombre} particulièrement intéressant.

À Ubrique, vous trouverez tout ce dont vous avez besoin pour développer un article en cuir : fournisseurs de matières premières, entreprises auxiliaires spécialisées (coupe, gaufrage, estampage, refente) et fabricants expérimentés dans tous types d'articles et de finitions. Près de 200 entreprises formant un écosystème unique, avec l'avantage qu'Asopiel agit en tant qu'intermédiaire pour rendre le processus plus agile et direct.

Si vous êtes en phase de recherche de production ou souhaitez explorer ce qu'Ubrique peut offrir à votre projet, nous serons ravis d'échanger avec vous.`
    },
    de: {
      asunto: 'Asopiel · Entwickeln Sie Ihr Projekt in Ubrique',
      intro: `Wir sind Asopiel, der Lederwarenverband aus Ubrique (Spanien), und das Projekt von {nombre} hat unser Interesse geweckt.

In Ubrique finden Sie alles, was Sie für die Entwicklung eines Lederwaren-Produkts benötigen: Rohstofflieferanten, spezialisierte Hilfsbetriebe (Zuschnitt, Prägung, Stempelung, Spalten) und Hersteller mit Erfahrung in allen Arten von Artikeln und Verarbeitungen. Fast 200 Unternehmen bilden ein einzigartiges Ökosystem, wobei Asopiel als Vermittler fungiert, um den Prozess effizienter und direkter zu gestalten.

Wenn Sie sich in der Produktionssuche befinden oder erkunden möchten, was Ubrique für Ihr Projekt bieten kann, sprechen wir gerne mit Ihnen.`
    },
    it: {
      asunto: 'Asopiel · Sviluppa il tuo progetto a Ubrique',
      intro: `Siamo Asopiel, l'associazione imprenditoriale della pelletteria di Ubrique (Spagna), e abbiamo trovato interessante il progetto di {nombre}.

A Ubrique troverete tutto ciò di cui avete bisogno per sviluppare un articolo in pelle: fornitori di materie prime, aziende ausiliarie specializzate (taglio, goffratura, stampaggio, spaccatura) e produttori esperti in tutti i tipi di articoli e finiture. Quasi 200 aziende che formano un ecosistema unico, con il vantaggio che Asopiel agisce da intermediario per rendere il processo più agile e diretto.

Se siete in fase di ricerca di produzione o volete esplorare cosa può offrire Ubrique al vostro progetto, saremo lieti di parlare con voi.`
    },
    pt: {
      asunto: 'Asopiel · Desenvolva o seu projeto em Ubrique',
      intro: `Somos a Asopiel, a associação empresarial da marroquinaria de Ubrique (Espanha), e achámos o projeto de {nombre} muito interessante.

Em Ubrique encontrará tudo o que precisa para desenvolver um artigo de pele: fornecedores de matérias-primas, empresas auxiliares especializadas (corte, gravação, estampagem, divisão) e fabricantes com experiência em todo o tipo de artigos e acabamentos. Cerca de 200 empresas que formam um ecossistema único, com a vantagem de a Asopiel atuar como intermediária para tornar o processo mais ágil e direto.

Se estão em fase de procura de produção ou querem explorar o que Ubrique pode oferecer ao vosso projeto, teremos todo o gosto em falar convosco.`
    },
    zh: {
      asunto: 'Asopiel · 在乌布里克开发您的{nombre}项目',
      intro: `我们是Asopiel，西班牙乌布里克皮具行业协会，我们对{nombre}的项目很感兴趣。

在乌布里克，您可以找到开发皮具产品所需的一切：原材料供应商、专业辅助企业（裁切、压纹、烫印、削薄）以及在各类产品和工艺方面经验丰富的制造商。近200家企业形成独特的生态系统，Asopiel作为中间人使流程更加敏捷直接。

如果您正在寻找生产资源或想探索乌布里克能为您的项目提供什么，我们很乐意与您交流。`
    },
    ja: {
      asunto: 'Asopiel · ウブリケで{nombre}のプロジェクトを発展させましょう',
      intro: `私どもはAsopiel、スペイン・ウブリケの皮革製品業界協会です。{nombre}様のプロジェクトに興味を持ちご連絡させていただきました。

ウブリケでは、皮革製品を開発するために必要なすべてのものが揃っています。原材料サプライヤー、専門補助企業（裁断、エンボス加工、スタンピング、漉き）、あらゆる種類の製品と仕上げに経験豊富なメーカーなど。約200社がユニークなエコシステムを形成しており、Asopielが仲介者として機能することでプロセスをより迅速かつ直接的にする利点があります。

製造先を探している段階であるか、ウブリケがあなたのプロジェクトに何を提供できるかを探りたい場合は、ぜひお話しましょう。`
    }
  }
};

// ─── GENERACIÓN DE CORREO ──────────────────────────────────────────────────
async function generarMail(marca, env) {
  const idioma = marca.idioma || 'es';
  const clasificacion = marca.clasificacion_contacto || 'premium';
  const plantillaGrupo = PLANTILLAS[clasificacion] || PLANTILLAS['premium'];
  const plantilla = plantillaGrupo[idioma] || plantillaGrupo['en'];

  const introPersonalizada = plantilla.intro.replace(/\{nombre\}/g, marca.nombre);

  const prompt = `Eres el equipo de comunicación de Asopiel, la asociación de empresarios del sector de la piel de Ubrique (España).
Debes redactar un email de primer contacto profesional y personalizado para la marca "${marca.nombre}" en idioma con código "${idioma}".

Información disponible sobre la marca:
- País: ${marca.pais || 'desconocido'}
- Segmento: ${marca.segmento || 'premium'}
- Clasificación: ${clasificacion}
- Precio medio bolso: ${marca.precio_medio_bolso ? `${marca.precio_medio_bolso}€` : 'no disponible'}
- Lugar de fabricación actual: ${marca.lugar_fabricacion || 'no disponible'}
- Descripción: ${marca.descripcion || ''}
- Notas: ${marca.notas || ''}

Texto base del email (úsalo tal cual, sin cambiarlo significativamente):
"""
${introPersonalizada}
"""

Instrucciones:
1. Usa el texto base anterior como cuerpo principal del email
2. Puedes añadir UNA frase personalizada al inicio basada en algo concreto de la marca (su estilo, su origen, su momento de crecimiento)
3. No cambies el mensaje principal ni el tono
4. NO incluyas asunto, firma ni despedida — solo el cuerpo del email
5. Longitud total: máximo 5 párrafos

Responde ÚNICAMENTE con el cuerpo del email, sin asunto ni firma.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Error API Claude: ${response.status}`);
  const data = await response.json();
  const cuerpo = data.content[0].text.trim();
  const asunto = plantilla.asunto.replace(/\{nombre\}/g, marca.nombre);

  return { asunto, cuerpo: cuerpo + FIRMA, idioma, clasificacion };
}

// ─── ENVÍO DE CORREO ───────────────────────────────────────────────────────
async function enviarMail(marca, mail, env) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${env.FROM_NAME || 'Antonio L. Ardila Jaén · Asopiel'} <${env.FROM_EMAIL || 'gerencia@asopiel.com'}>`,
      to: [marca.email_contacto],
      subject: mail.asunto,
      text: mail.cuerpo
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Error Resend: ${err}`);
  }
  return await response.json();
}

// ─── GUARDAR MARCAS EN D1 ──────────────────────────────────────────────────
async function guardarMarcaEnDB(ficha, fuente, env) {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  await env.MARCADAR_DB.prepare(`
    INSERT OR IGNORE INTO marcas (
      id, nombre, web, pais, idioma, segmento, clasificacion_contacto,
      precio_medio_bolso, facturacion_estimada, lugar_fabricacion,
      instagram, facebook, tiktok, linkedin,
      email_contacto, telefono, descripcion, notas,
      estado, fuente_rastreo, rastreada_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rastreada', ?, ?)
  `).bind(
    id, ficha.nombre, ficha.web, ficha.pais, ficha.idioma,
    ficha.segmento, ficha.clasificacion_contacto || null,
    ficha.precio_medio_bolso, ficha.facturacion_estimada,
    ficha.lugar_fabricacion, ficha.instagram, ficha.facebook,
    ficha.tiktok, ficha.linkedin, ficha.email_contacto,
    ficha.telefono, ficha.descripcion, ficha.notas,
    fuente, now
  ).run();

  return id;
}

// ─── ROUTER PRINCIPAL ──────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    // ── LOGIN ADMIN ──────────────────────────────────────────────────────────
    if (path === '/login' && method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (password === env.ADMIN_PASSWORD) {
        return jsonResponse({ ok: true, token: env.ADMIN_PASSWORD });
      }
      return errorResponse('Contraseña incorrecta', 401);
    }

    // ── LOGIN ASOCIADO ───────────────────────────────────────────────────────
    if (path === '/asociado/login' && method === 'POST') {
      const { clave } = await request.json().catch(() => ({}));
      if (!clave) return errorResponse('Clave requerida');

      const hash = await hashClave(clave);
      const asociado = await env.MARCADAR_DB.prepare(
        'SELECT id, nombre, empresa FROM asociados WHERE clave_hash = ? AND activo = 1'
      ).bind(hash).first();

      if (!asociado) return errorResponse('Clave incorrecta', 401);

      // Token de asociado: "asociado:<hash>" — el Worker lo verifica internamente
      return jsonResponse({
        ok: true,
        token: `asociado:${hash}`,
        asociado_id: asociado.id,
        nombre: asociado.nombre,
        empresa: asociado.empresa
      });
    }

    // ── Verificar token (admin o asociado) ───────────────────────────────────
    const authHeader = (request.headers.get('Authorization') || '').replace('Bearer ', '');
    const isAdmin = authHeader === env.ADMIN_PASSWORD;

    // Para rutas de asociado necesitamos el asociado_id
    let asociadoActual = null;
    if (!isAdmin && authHeader.startsWith('asociado:')) {
      const hash = authHeader.slice('asociado:'.length);
      asociadoActual = await env.MARCADAR_DB.prepare(
        'SELECT id, nombre, empresa FROM asociados WHERE clave_hash = ? AND activo = 1'
      ).bind(hash).first();
    }

    // ── RUTAS DE ASOCIADO ────────────────────────────────────────────────────

    // GET /asociado/mis-marcas — ver mis marcas bloqueadas
    if (path === '/asociado/mis-marcas' && method === 'GET') {
      if (!asociadoActual) return errorResponse('No autenticado', 401);
      const { results } = await env.MARCADAR_DB.prepare(
        'SELECT id, nombre, web, notas, created_at FROM marcas_bloqueadas WHERE asociado_id = ? ORDER BY created_at DESC'
      ).bind(asociadoActual.id).all();
      return jsonResponse({ ok: true, data: results });
    }

    // POST /asociado/mis-marcas — añadir marca bloqueada
    if (path === '/asociado/mis-marcas' && method === 'POST') {
      if (!asociadoActual) return errorResponse('No autenticado', 401);
      const body = await request.json().catch(() => ({}));
      if (!body.nombre) return errorResponse('El nombre es requerido');

      const id = crypto.randomUUID().slice(0, 8);
      const nombreNorm = normalizarNombre(body.nombre);
      const dominio = normalizarDominio(body.web);

      // Comprobar si ya existe (mismo asociado)
      const existe = await env.MARCADAR_DB.prepare(
        'SELECT id FROM marcas_bloqueadas WHERE nombre_norm = ? AND asociado_id = ?'
      ).bind(nombreNorm, asociadoActual.id).first();

      if (existe) return errorResponse('Esta marca ya está en tu lista', 409);

      await env.MARCADAR_DB.prepare(`
        INSERT INTO marcas_bloqueadas (id, nombre, nombre_norm, web, web_dominio, asociado_id, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, body.nombre.trim(), nombreNorm, body.web || null, dominio, asociadoActual.id, body.notas || null).run();

      return jsonResponse({ ok: true, id }, 201);
    }

    // DELETE /asociado/mis-marcas/:id — eliminar mi marca bloqueada
    const miMarcaMatch = path.match(/^\/asociado\/mis-marcas\/([^/]+)$/);
    if (miMarcaMatch && method === 'DELETE') {
      if (!asociadoActual) return errorResponse('No autenticado', 401);
      await env.MARCADAR_DB.prepare(
        'DELETE FROM marcas_bloqueadas WHERE id = ? AND asociado_id = ?'
      ).bind(miMarcaMatch[1], asociadoActual.id).run();
      return jsonResponse({ ok: true });
    }

    // ── RUTAS PROTEGIDAS (solo admin) ────────────────────────────────────────
    if (!isAdmin) {
      return errorResponse('No autenticado', 401);
    }

    // ── ADMIN: GESTIÓN DE ASOCIADOS ──────────────────────────────────────────

    // GET /admin/asociados — listar asociados
    if (path === '/admin/asociados' && method === 'GET') {
      const { results } = await env.MARCADAR_DB.prepare(
        'SELECT id, nombre, empresa, activo, created_at FROM asociados ORDER BY nombre'
      ).all();
      return jsonResponse({ ok: true, data: results });
    }

    // POST /admin/asociados — crear asociado
    if (path === '/admin/asociados' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.nombre || !body.clave) return errorResponse('nombre y clave son requeridos');

      const id = crypto.randomUUID().slice(0, 8);
      const hash = await hashClave(body.clave);

      await env.MARCADAR_DB.prepare(`
        INSERT INTO asociados (id, nombre, empresa, clave_hash, activo)
        VALUES (?, ?, ?, ?, 1)
      `).bind(id, body.nombre.trim(), body.empresa || null, hash).run();

      return jsonResponse({ ok: true, id }, 201);
    }

    // PUT /admin/asociados/:id — actualizar asociado (resetear clave o cambiar nombre)
    const asociadoMatch = path.match(/^\/admin\/asociados\/([^/]+)$/);
    if (asociadoMatch && method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const sets = [];
      const vals = [];

      if (body.nombre) { sets.push('nombre = ?'); vals.push(body.nombre.trim()); }
      if (body.empresa !== undefined) { sets.push('empresa = ?'); vals.push(body.empresa); }
      if (typeof body.activo === 'number') { sets.push('activo = ?'); vals.push(body.activo); }
      if (body.clave) {
        const hash = await hashClave(body.clave);
        sets.push('clave_hash = ?');
        vals.push(hash);
      }
      if (!sets.length) return errorResponse('Sin campos a actualizar');
      sets.push('updated_at = ?');
      vals.push(new Date().toISOString());
      vals.push(asociadoMatch[1]);

      await env.MARCADAR_DB.prepare(`UPDATE asociados SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return jsonResponse({ ok: true });
    }

    // DELETE /admin/asociados/:id — eliminar asociado
    if (asociadoMatch && method === 'DELETE') {
      await env.MARCADAR_DB.prepare('DELETE FROM asociados WHERE id = ?').bind(asociadoMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── ADMIN: GESTIÓN DE MARCAS BLOQUEADAS ──────────────────────────────────

    // GET /admin/marcas-bloqueadas — listar todas (con nombre del asociado)
    if (path === '/admin/marcas-bloqueadas' && method === 'GET') {
      const { results } = await env.MARCADAR_DB.prepare(`
        SELECT mb.id, mb.nombre, mb.web, mb.notas, mb.created_at,
               a.nombre AS asociado_nombre, a.empresa AS asociado_empresa
        FROM marcas_bloqueadas mb
        JOIN asociados a ON a.id = mb.asociado_id
        ORDER BY mb.created_at DESC
      `).all();
      return jsonResponse({ ok: true, data: results });
    }

    // POST /admin/marcas-bloqueadas — añadir directamente como admin (asignando a un asociado)
    if (path === '/admin/marcas-bloqueadas' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.nombre || !body.asociado_id) return errorResponse('nombre y asociado_id son requeridos');

      const id = crypto.randomUUID().slice(0, 8);
      const nombreNorm = normalizarNombre(body.nombre);
      const dominio = normalizarDominio(body.web);

      await env.MARCADAR_DB.prepare(`
        INSERT INTO marcas_bloqueadas (id, nombre, nombre_norm, web, web_dominio, asociado_id, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, body.nombre.trim(), nombreNorm, body.web || null, dominio, body.asociado_id, body.notas || null).run();

      return jsonResponse({ ok: true, id }, 201);
    }

    // DELETE /admin/marcas-bloqueadas/:id — eliminar entrada bloqueada
    const bloqueadaMatch = path.match(/^\/admin\/marcas-bloqueadas\/([^/]+)$/);
    if (bloqueadaMatch && method === 'DELETE') {
      await env.MARCADAR_DB.prepare('DELETE FROM marcas_bloqueadas WHERE id = ?').bind(bloqueadaMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── STATS ────────────────────────────────────────────────────────────────
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
      const bloqueadas = await env.MARCADAR_DB.prepare('SELECT COUNT(*) as total FROM marcas_bloqueadas').first();
      const paisDelDia = getPaisDelDia();
      return jsonResponse({ ok: true, data: { ...stats, bloqueadas: bloqueadas.total }, pais_del_dia: paisDelDia });
    }

    // ── PAÍS DEL DÍA ─────────────────────────────────────────────────────────
    if (path === '/pais-del-dia' && method === 'GET') {
      return jsonResponse({ ok: true, pais: getPaisDelDia() });
    }

    // ── BÚSQUEDA AUTÓNOMA POR PAÍS ────────────────────────────────────────────
    if (path === '/buscar-por-pais' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const pais = body.pais || getPaisDelDia();

      const { results: descartadas } = await env.MARCADAR_DB.prepare(
        "SELECT nombre FROM marcas WHERE estado = 'descartada'"
      ).all();

      const listaNegra = await getMarcasBloqueadas(env);

      let marcas;
      try {
        marcas = await buscarMarcasPorPais(pais, descartadas || [], listaNegra, env);
      } catch (e) {
        return errorResponse(`Error en búsqueda: ${e.message}`, 500);
      }

      const guardadas = [];
      for (const ficha of marcas) {
        try {
          const id = await guardarMarcaEnDB(ficha, `busqueda:${pais}`, env);
          guardadas.push({ id, ...ficha });
        } catch (e) {
          // duplicado — saltar
        }
      }

      return jsonResponse({ ok: true, pais, total: guardadas.length, data: guardadas });
    }

    // ── RASTREAR MARCA CONCRETA ───────────────────────────────────────────────
    if (path === '/marcas/rastrear' && method === 'POST') {
      const { url_o_nombre } = await request.json().catch(() => ({}));
      if (!url_o_nombre) return errorResponse('url_o_nombre es requerido');

      let ficha;
      try {
        ficha = await rastrearMarca(url_o_nombre, env);
      } catch (e) {
        return errorResponse(`Error en rastreo: ${e.message}`, 500);
      }

      // Comprobar si está bloqueada
      const listaNegra = await getMarcasBloqueadas(env);
      if (estaBloqueada(ficha, listaNegra)) {
        return errorResponse('Esta marca está bloqueada (ya trabaja con un asociado)', 409);
      }

      const id = await guardarMarcaEnDB(ficha, url_o_nombre, env);
      return jsonResponse({ ok: true, id, data: ficha }, 201);
    }

    // ── LISTAR MARCAS ─────────────────────────────────────────────────────────
    if (path === '/marcas' && method === 'GET') {
      const estado = url.searchParams.get('estado');
      const pais = url.searchParams.get('pais');
      const aprobada = url.searchParams.get('aprobada');

      let sql = 'SELECT * FROM marcas WHERE 1=1';
      const params = [];

      if (estado) { sql += ' AND estado = ?'; params.push(estado); }
      if (pais) { sql += ' AND pais = ?'; params.push(pais); }
      if (aprobada !== null && aprobada !== '') {
        sql += ' AND aprobada_contacto = ?';
        params.push(aprobada === '1' ? 1 : 0);
      }
      sql += ' ORDER BY created_at DESC';

      const { results } = await env.MARCADAR_DB.prepare(sql).bind(...params).all();
      return jsonResponse({ ok: true, data: results });
    }

    // ── OBTENER MARCA ─────────────────────────────────────────────────────────
    const marcaMatch = path.match(/^\/marcas\/([^/]+)$/);
    if (marcaMatch && method === 'GET') {
      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?').bind(marcaMatch[1]).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);
      return jsonResponse({ ok: true, data: marca });
    }

    // ── ACTUALIZAR MARCA ──────────────────────────────────────────────────────
    if (marcaMatch && method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!body) return errorResponse('Body inválido');

      const campos = [
        'nombre', 'web', 'pais', 'idioma', 'segmento', 'clasificacion_contacto',
        'precio_medio_bolso', 'facturacion_estimada', 'lugar_fabricacion',
        'instagram', 'facebook', 'tiktok', 'linkedin',
        'email_contacto', 'telefono', 'descripcion', 'notas', 'estado'
      ];
      const sets = [];
      const vals = [];
      for (const c of campos) {
        if (c in body) { sets.push(`${c} = ?`); vals.push(body[c]); }
      }
      if (!sets.length) return errorResponse('Sin campos a actualizar');
      sets.push('updated_at = ?');
      vals.push(new Date().toISOString());
      vals.push(marcaMatch[1]);

      await env.MARCADAR_DB.prepare(`UPDATE marcas SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return jsonResponse({ ok: true });
    }

    // ── ELIMINAR MARCA ────────────────────────────────────────────────────────
    if (marcaMatch && method === 'DELETE') {
      await env.MARCADAR_DB.prepare('DELETE FROM marcas WHERE id = ?').bind(marcaMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── APROBAR MARCA ─────────────────────────────────────────────────────────
    const aprobarMatch = path.match(/^\/marcas\/([^/]+)\/aprobar$/);
    if (aprobarMatch && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const now = new Date().toISOString();
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET aprobada_contacto = 1, aprobada_at = ?, updated_at = ?,
        clasificacion_contacto = COALESCE(?, clasificacion_contacto) WHERE id = ?
      `).bind(now, now, body.clasificacion_contacto || null, aprobarMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── DESAPROBAR MARCA ──────────────────────────────────────────────────────
    const desaprobarMatch = path.match(/^\/marcas\/([^/]+)\/desaprobar$/);
    if (desaprobarMatch && method === 'POST') {
      const now = new Date().toISOString();
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET aprobada_contacto = 0, aprobada_at = null, updated_at = ? WHERE id = ?
      `).bind(now, desaprobarMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── DESCARTAR MARCA ───────────────────────────────────────────────────────
    const descartarMatch = path.match(/^\/marcas\/([^/]+)\/descartar$/);
    if (descartarMatch && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const now = new Date().toISOString();
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET estado = 'descartada', notas = COALESCE(?, notas), updated_at = ? WHERE id = ?
      `).bind(body.motivo || null, now, descartarMatch[1]).run();
      return jsonResponse({ ok: true });
    }

    // ── GENERAR MAIL ──────────────────────────────────────────────────────────
    const generarMailMatch = path.match(/^\/marcas\/([^/]+)\/mail\/generar$/);
    if (generarMailMatch && method === 'POST') {
      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?').bind(generarMailMatch[1]).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);
      if (!marca.aprobada_contacto) return errorResponse('La marca no está aprobada para contacto', 403);

      let mail;
      try {
        mail = await generarMail(marca, env);
      } catch (e) {
        return errorResponse(`Error generando mail: ${e.message}`, 500);
      }

      const mailId = crypto.randomUUID().slice(0, 8);
      await env.MARCADAR_DB.prepare(`
        INSERT INTO mails (id, marca_id, idioma, asunto, cuerpo, estado)
        VALUES (?, ?, ?, ?, ?, 'borrador')
      `).bind(mailId, generarMailMatch[1], mail.idioma, mail.asunto, mail.cuerpo).run();

      return jsonResponse({ ok: true, mail_id: mailId, data: mail });
    }

    // ── ENVIAR MAIL ───────────────────────────────────────────────────────────
    const enviarMailMatch = path.match(/^\/mails\/([^/]+)\/enviar$/);
    if (enviarMailMatch && method === 'POST') {
      const mailRec = await env.MARCADAR_DB.prepare('SELECT * FROM mails WHERE id = ?').bind(enviarMailMatch[1]).first();
      if (!mailRec) return errorResponse('Mail no encontrado', 404);
      if (mailRec.estado === 'enviado') return errorResponse('Este mail ya fue enviado', 409);

      const marca = await env.MARCADAR_DB.prepare('SELECT * FROM marcas WHERE id = ?').bind(mailRec.marca_id).first();
      if (!marca) return errorResponse('Marca no encontrada', 404);
      if (!marca.email_contacto) return errorResponse('La marca no tiene email de contacto', 422);

      let resultado;
      try {
        resultado = await enviarMail(marca, mailRec, env);
      } catch (e) {
        return errorResponse(`Error enviando mail: ${e.message}`, 500);
      }

      const now = new Date().toISOString();
      await env.MARCADAR_DB.prepare(`
        UPDATE mails SET estado = 'enviado', enviado_at = ?, message_id_externo = ?, proveedor_envio = 'resend' WHERE id = ?
      `).bind(now, resultado.id || null, enviarMailMatch[1]).run();
      await env.MARCADAR_DB.prepare(`
        UPDATE marcas SET mail_enviado = 1, mail_enviado_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, mailRec.marca_id).run();

      return jsonResponse({ ok: true, message_id: resultado.id });
    }

    // ── LISTAR MAILS DE UNA MARCA ─────────────────────────────────────────────
    const mailsMarcaMatch = path.match(/^\/marcas\/([^/]+)\/mails$/);
    if (mailsMarcaMatch && method === 'GET') {
      const { results } = await env.MARCADAR_DB.prepare(
        'SELECT * FROM mails WHERE marca_id = ? ORDER BY generado_at DESC'
      ).bind(mailsMarcaMatch[1]).all();
      return jsonResponse({ ok: true, data: results });
    }

    return errorResponse('Ruta no encontrada', 404);
  }
};
