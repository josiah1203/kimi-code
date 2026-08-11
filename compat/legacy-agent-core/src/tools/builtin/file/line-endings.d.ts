export type LineEndingStyle = 'lf' | 'crlf' | 'mixed';
export interface ModelTextView {
    text: string;
    lineEndingStyle: LineEndingStyle;
}
export declare function detectLineEndingStyle(text: string): LineEndingStyle;
export declare function toModelTextView(raw: string): ModelTextView;
export declare function materializeModelText(text: string, lineEndingStyle: LineEndingStyle): string;
export declare function makeCarriageReturnsVisible(text: string): string;
