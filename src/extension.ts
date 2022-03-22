import * as path from 'path';

import Base from 'sdk-base';
import {
  Definition,
  DefinitionProvider,
  DocumentSelector,
  DocumentSemanticTokensProvider,
  ExtensionContext,
  Hover,
  HoverProvider,
  languages,
  Location,
  LocationLink,
  OutputChannel,
  Position,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocument,
  window,
} from 'vscode';
import * as Parser from 'web-tree-sitter';

import CONSTANTS from './constants';

const parserPromise = Parser.init();

/**
 * GYP support: DocumentSemanticTokensProvider
 */
class GYPSupport extends Base implements DefinitionProvider, DocumentSemanticTokensProvider, HoverProvider {
  /**
   * Decode the semantic tokens.
   * @param semanticTokens The semantic tokens to decode.
   * @return {{ resultId: string | undefined, data: { line: number, startChar: number, length: number, tokenType: number, tokenModifiers: number }[] }} The decoded data.
   */
  static decodeSemanticTokens(semanticTokens: SemanticTokens): {
    resultId: string | undefined;
    data: {
      line: number;
      startChar: number;
      length: number;
      tokenType: number;
      tokenModifiers: number;
    }[]
  } {
    const { resultId, data } = semanticTokens;
    const ret = [];
    for (let i = 0; i < data.length; i += 5) {
      const line = data[i];
      const startChar = data[i + 1];
      const length = data[i + 2];
      const tokenType = data[i + 3];
      const tokenModifiers = data[i + 4];
      ret.push({ line, startChar, length, tokenType, tokenModifiers });
    }

    return { resultId, data: ret };
  }

  static encodeModifiers(modifiers: string[] | string): number {
    if (typeof modifiers === 'string') {
      modifiers = [ modifiers ];
    }

    let ret = 0;
    for (const modifier of modifiers) {
      let num = GYPSupport.tokenModifiers.get(modifier);
      if (num === undefined) {
        num = GYPSupport.tokenModifiers.size + 2;
      }
      // eslint-disable-next-line no-bitwise
      ret = ret | (1 << num!);
    }
    return ret;
  }

  static tryGetKeyNameType(node: Parser.SyntaxNode): string | null {
    const keyName = node.text.substr(1, node.text.length - 2);
    for (const key in CONSTANTS) {
      if (!CONSTANTS.hasOwnProperty(key)) continue;
      const candidates = CONSTANTS[key];
      if (!Array.isArray(candidates)) continue;
      if (candidates.includes(keyName)) {
        return key;
      }
    }

    return null;
  }

  static tryColorKeyName(node: Parser.SyntaxNode): [string, string] | null {
    const type = GYPSupport.tryGetKeyNameType(node);
    if (!type) return null;
    return GYPSupport.matchedKeysTokenTypesAndModifiersMap.get(type) as [ string, string ];
  }

  /**
   * The token types that this provider can provide.
   */
  static tokenTypes: Map<string, number> = new Map();

  /**
   * The token modifiers that this provider supports.
   */
  static tokenModifiers: Map<string, number> = new Map();

  /**
   * The legend of the semantic tokens.
   */
  static legend: SemanticTokensLegend = (() => {
    const tokenTypesLegend = [
      'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
      'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
      'method', 'decorator', 'macro', 'variable', 'parameter', 'property', 'label',
    ];
    tokenTypesLegend.forEach((tokenType, index) => GYPSupport.tokenTypes.set(tokenType, index));

    const tokenModifiersLegend = [
      'declaration', 'documentation', 'readonly', 'static', 'abstract', 'deprecated',
      'modification', 'async', 'defaultLibrary',
    ];
    tokenModifiersLegend.forEach((tokenModifier, index) => GYPSupport.tokenModifiers.set(tokenModifier, index));

    return new SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
  })();

  static matchedKeysTokenTypesAndModifiersMap: Map<string, [string, string]> = new Map([
    [ 'GYP_SECTION', [ 'enum', 'defaultLibrary' ]],
    [ 'GYP_TARGETS_SECTION', [ 'namespace', 'defaultLibrary' ]],
    [ 'GYP_CONFIGURATIONS_SECTION', [ 'macro', 'defaultLibrary' ]],
    [ 'GYP_ACTIONS_SECTION', [ 'operator', 'defaultLibrary' ]],
    [ 'GYP_RULES_SECTION', [ 'property', 'defaultLibrary' ]],
    [ 'GYP_COPIES_SECTION', [ 'operator', 'defaultLibrary' ]],
  ]);

  /**
   * The document selector for this provider.
   */
  static documentSelector: DocumentSelector = [{
    pattern: '**/*.gyp',
  }, {
    pattern: '**/*.gypi',
  }];

  /**
   * The output channel for this provider.
   */
  static channel: OutputChannel;

  /**
   * The parser for this provider.
   */
  #parser: Parser;

  /**
   * The cached tree to be used.
   */
  #trees: WeakMap<TextDocument, Parser.Tree> = new WeakMap();

  /**
   * The cached targets to be used in target Goto.
   */
  #targets: WeakMap<TextDocument, Map<string, Location>> = new WeakMap();

  /**
   * The constructor.
   */
  constructor() {
    super({ initMethod: '#init' });
    this.#parser = null as any; // for lint
  }

  /**
   * Initialize the provider.
   */
  async ['#init']() {
    await parserPromise;
    this.#parser = new Parser();
    const Python = await Parser.Language.load(
      path.join(__dirname, '../tree-sitter-python_legesher.wasm'));
    this.#parser.setLanguage(Python);
  }

  /**
   * The output channl object of VSCode.
   */
  get channel(): OutputChannel {
    if (!GYPSupport.channel) {
      GYPSupport.channel = window.createOutputChannel('GYP Support');
    }

    return GYPSupport.channel;
  }

  #isBuiltInKey(node: Parser.SyntaxNode): boolean {
    // string with pair inside of dictionary:
    //
    // dictionary
    //  {
    //  pair
    //   string
    //   :
    //   ...
    //  ,
    //  pair
    //   ...
    //  }
    //
    if (node.type !== 'string') return false;
    if (node?.parent?.type !== 'pair') return false;
    if (node?.parent?.parent?.type !== 'dictionary') return false;

    const pair = node.parent;
    if (pair.child(0)?.id !== node.id) return false;
    return true;
  }

  #tryKeyName(node: Parser.SyntaxNode, builder: SemanticTokensBuilder): boolean {
    if (!this.#isBuiltInKey) return false;

    // The filtered node is the key name.
    const color = GYPSupport.tryColorKeyName(node);
    if (!color) return false;

    builder.push(
      node.startPosition.row,
      node.startPosition.column,
      node.text.length,
      GYPSupport.tokenTypes.get(color[0]) as number,
      GYPSupport.encodeModifiers(color[1]));

    return true;
  }

  #tryStoreTargetName(document: TextDocument, node: Parser.SyntaxNode): boolean {
    if (node.type !== 'string') return false;
    if (node?.parent?.type !== 'pair') return false;
    if (node?.parent?.parent?.type !== 'dictionary') return false;

    const pair = node.parent;
    if (pair.child(2)?.id !== node.id) return false;
    const key = pair.child(0);
    if (key?.type !== 'string') return false;
    if (key.text.substring(1, key.text.length - 1) !== 'target_name') return false;

    const map = this.#targets.get(document);
    if (!map) return false;
    map.set(
      node.text.substring(1, node.text.length - 1),
      new Location(document.uri, new Position(key.startPosition.row, key.startPosition.column)));

    return true;
  }

  #tryGetTargetDefinitionViaNode(document: TextDocument, node: Parser.SyntaxNode): Location | null {
    const map = this.#targets.get(document);
    if (!map) return null;

    if (node.type !== 'string') return null;
    if (node?.parent?.type !== 'list') return null;
    if (node.parent.parent?.type !== 'pair') return null;
    const checkKey = node.parent.parent.child(0)?.text;
    if (!checkKey) return null;
    if (checkKey.substring(1, checkKey.length - 1) !== 'dependencies') return null;

    const targetName = node.text.substring(1, node.text.length - 1);
    return map.get(targetName) || null;
  }

  #walk(document: TextDocument, node: Parser.SyntaxNode, depth: number, builder: SemanticTokensBuilder) {
    let processed = false;
    if (!processed) processed = this.#tryKeyName(node, builder);
    if (!processed) processed = this.#tryStoreTargetName(document, node);

    for (const child of node.children) {
      this.#walk(document, child, depth + 1, builder);
    }
  }

  async provideDefinition(
    document: TextDocument,
    position: Position,
  ): Promise<Definition | LocationLink[]> {
    const tree = this.#trees.get(document);
    if (!tree) return null as any;

    const node = tree.rootNode.descendantForPosition({
      row: position.line,
      column: position.character,
    });
    if (!node) return null as any;

    this.channel.appendLine(`provideDefinition: ${document.uri}, position: ${position.line}:${position.character}`);
    const definition = this.#tryGetTargetDefinitionViaNode(document, node);
    if (!definition) return null as any;

    return definition;
  }

  /**
   * Provide the semantic tokens for the given document.
   * @param document The document to provide semantic tokens for.
   * @return {Promise<SemanticTokens>} The semantic tokens for the given document.
   */
  async provideDocumentSemanticTokens(
    document: TextDocument,
  ): Promise<SemanticTokens> {
    await this.ready();

    const builder = new SemanticTokensBuilder(GYPSupport.legend);
    const oldTree: Parser.Tree | undefined = this.#trees.get(document);
    this.channel.appendLine(`onProvideDocumentSemanticTokens: ${!!oldTree}, ${document.uri.fsPath}`);
    const tree = this.#parser.parse(document.getText() /* , oldTree */);
    this.#trees.set(document, tree);
    this.#targets.set(document, new Map());
    this.#walk(document, tree.rootNode, 0, builder);
    const ret = builder.build();

    return ret;
  }

  async provideHover(
    document: TextDocument,
    pos: Position,
  ): Promise<Hover> {
    const tree = this.#trees.get(document);
    if (!tree) return null as any;

    const node = tree.rootNode.descendantForPosition({
      row: pos.line,
      column: pos.character,
    });
    if (!node) return null as any;

    if (!this.#isBuiltInKey(node)) return null as any;

    this.channel.appendLine(`onProvideHover: ${document.uri.fsPath}, position: ${pos.line}:${pos.character}`);
    const type = GYPSupport.tryGetKeyNameType(node);
    if (!type) return null as any;

    const keyName = node.text.substring(1, node.text.length - 1);
    const idx = (CONSTANTS[type] as string[]).indexOf(keyName);
    const docs = CONSTANTS[`${type}_DOCUMENTATION`] as string[];
    let doc = docs[idx];
    if (!doc) return null as any;

    const links: { [key: string]: string } = CONSTANTS.links as any;
    const blocks: { [key: string]: string } = CONSTANTS.blocks as any;
    if (links[keyName]) {
      doc += `\n\n---\n${blocks[keyName]}\n---\nReference: ${links[keyName]}`;
    }

    return new Hover(doc);
  }
}

/**
 * Activate the extension.
 * @param context The extension context.
 */
export async function activate(context: ExtensionContext) {
  // Do use emcc <= v2.0.17 to compile WASM file, or it will crash.
  // Refs:
  //   - https://github.com/tree-sitter/tree-sitter/issues/1652#issuecomment-1040228808
  //   - https://github.com/tree-sitter/tree-sitter/issues/1098#issuecomment-842326203

  const gyp = new GYPSupport();
  context.subscriptions.push(
    languages.registerDocumentSemanticTokensProvider(
      GYPSupport.documentSelector,
      gyp,
      GYPSupport.legend));

  context.subscriptions.push(
    languages.registerHoverProvider({ language: 'gyp' }, gyp));

  context.subscriptions.push(
    languages.registerDefinitionProvider({ language: 'gyp' }, gyp));
}
