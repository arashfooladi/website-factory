(() => {
  const accessibleLabel = element => element.getAttribute('aria-label') ||
    (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ') ||
    Array.from(element.labels || []).map(label => label.textContent.trim()).join(' ') || null;
  const selector = element => {
    if (element.id) return '#' + CSS.escape(element.id);
    const pieces = [];
    let item = element;
    for (let depth = 0; item && depth < 5; depth++, item = item.parentElement) {
      const tag = item.tagName.toLowerCase();
      const siblings = item.parentElement ? Array.from(item.parentElement.children).filter(sibling => sibling.tagName === item.tagName) : [item];
      pieces.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(item) + 1})` : ''));
      if (item.parentElement?.id) { pieces.unshift('#' + CSS.escape(item.parentElement.id)); break; }
    }
    return pieces.join(' > ');
  };
  const nodes = Array.from(document.querySelectorAll('body,header,main,nav,footer,section,article,form,[role=dialog],h1,h2,h3,a,button,input,select,textarea'));
  const elements = nodes.filter(element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, 120).map(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return {
      selector: selector(element), tag: element.tagName.toLowerCase(), text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
      role: element.getAttribute('role'), label: accessibleLabel(element), expanded: element.getAttribute('aria-expanded'),
      controls: element.getAttribute('aria-controls'), hasPopup: element.getAttribute('aria-haspopup'),
      disabled: element.disabled || element.getAttribute('aria-disabled') === 'true', checked: element.checked || element.getAttribute('aria-checked') === 'true',
      selected: element.getAttribute('aria-selected'), tabIndex: element.tabIndex,
      href: element.getAttribute('href'), type: element.getAttribute('type'), name: element.getAttribute('name'), required: element.hasAttribute('required'),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      style: { display: style.display, position: style.position, font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        color: style.color, background: style.backgroundColor, gap: style.gap, padding: style.padding, borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth, borderTopColor: style.borderTopColor }
    };
  });
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('input[type=password]').forEach(element => element.removeAttribute('value'));
  const html = '<!doctype html>\n' + clone.outerHTML;
  return { title: document.title, language: document.documentElement.lang, direction: document.documentElement.dir,
    images: Array.from(document.images).slice(0, 80).map(image => ({ src: image.currentSrc || image.src, alt: image.alt, width: image.naturalWidth, height: image.naturalHeight })),
    stylesheets: Array.from(document.querySelectorAll('link[rel=stylesheet]')).slice(0, 50).map(link => link.href),
    forms: Array.from(document.forms).slice(0, 20).map(form => ({ selector: selector(form), action: form.action, method: form.method,
      fields: Array.from(form.elements).slice(0, 40).map(field => ({ selector: selector(field), name: field.name, type: field.type, label: accessibleLabel(field), required: field.required || false })) })),
    scroll: { x: window.scrollX, y: window.scrollY }, page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    elements, html: html.slice(0, 1000000), htmlTruncated: html.length > 1000000, elementLimitReached: nodes.length > 120 };
})()
