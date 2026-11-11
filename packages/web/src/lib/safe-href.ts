/**
 * The links the read-only renderer turns into anchors: web pages, mail, and Apple Mail's
 * `message:` deep links. Anything else (javascript:, data:, …) is left as plain text.
 */
export const safeHref = (href: string) => (/^(https?:|mailto:|message:)/i.test(href) ? href : undefined)
