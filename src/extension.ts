import * as path from 'path';

import Base from 'sdk-base';
import {
  DocumentSelector,
  DocumentSemanticTokensProvider,
  ExtensionContext,
  languages,
  OutputChannel,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocument,
  window,
} from 'vscode';
import * as Parser from 'web-tree-sitter';

import { GYP_SECTION, GYP_TARGET_SECTION } from './constants';

const parserPromise = Parser.init();

/**
 * GYP support: DocumentSemanticTokensProvider
 */
class GYPSupport extends Base implements DocumentSemanticTokensProvider {
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

  /**
   * The document selector for this provider.
   */
  static documentSelector: DocumentSelector = [{
    pattern: '**/*.gyp',
    language: 'python',
  }, {
    pattern: '**/*.gypi',
    language: 'python',
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
   * The cached tree to be used in incremental parsing.
   */
  #trees: WeakMap<TextDocument, Parser.Tree> = new WeakMap();

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

  #tryKeyName(node: Parser.SyntaxNode, builder: SemanticTokensBuilder) {
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
    if (node.type !== 'string') return;
    if (node?.parent?.type !== 'pair') return;
    if (node?.parent?.parent?.type !== 'dictionary') return;

    const pair = node.parent;
    if (pair.child(0)?.id !== node.id) return;

    // The filtered node is the key name.
    const keyName = node.text.substr(1, node.text.length - 2);
    if (GYP_SECTION.includes(keyName)) {
      builder.push(
        node.startPosition.row,
        node.startPosition.column,
        node.text.length,
        GYPSupport.tokenTypes.get('type') as number,
        GYPSupport.encodeModifiers('defaultLibrary'));
    } else if (GYP_TARGET_SECTION.includes(keyName)) {
      builder.push(
        node.startPosition.row,
        node.startPosition.column,
        node.text.length,
        GYPSupport.tokenTypes.get('type') as number,
        GYPSupport.encodeModifiers('defaultLibrary'));
    }
  }

  #walk(node: Parser.SyntaxNode, depth: number, builder: SemanticTokensBuilder) {
    // console.log(`${' '.repeat(depth)}${node.type}`);
    this.#tryKeyName(node, builder);

    for (const child of node.children) {
      this.#walk(child, depth + 1, builder);
    }
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
    console.log(new Date(), 'onProvideDocumentSemanticTokens:', !!oldTree, document.uri.fsPath);
    const tree = this.#parser.parse(document.getText(), oldTree);
    this.#trees.set(document, tree);
    this.#walk(tree.rootNode, 0, builder);
    const ret = builder.build();

    // `ms-vscode.python` will make this `provideDocumentSemanticTokens()` lose
    // effectiveness. So I make a delay to make it effective.
    //
    // What I guess:
    //   1. `provideDocumentSemanticTokens()`;
    //   2. `ms-vscode.python` overwrites something (I don't know what it is);
    //   3. boom!
    return ret;
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
}
