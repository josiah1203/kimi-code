/** Escape XML content — escapes both tag and attribute boundary chars (& < > ") */
export declare function escapeXml(input: string): string;
/** Escape XML attribute value — only escapes attribute boundary chars (& "), not tag chars */
export declare function escapeXmlAttr(input: string): string;
/** Escape tag delimiters only — prevents XML tag injection without corrupting Markdown (& " stay literal) */
export declare function escapeXmlTags(input: string): string;
