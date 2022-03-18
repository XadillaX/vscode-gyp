import * as path from 'path';

import Base from 'sdk-base';
import {
  DocumentSelector,
  DocumentSemanticTokensProvider,
  ExtensionContext,
  languages,
  OutputChannel,
  ProviderResult,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocument,
  window,
} from 'vscode';
import * as Parser from 'web-tree-sitter';

/**
 * GYP support: DocumentSemanticTokensProvider
 */
class GYPSupport extends Base implements DocumentSemanticTokensProvider {
  /**
   * The token types that this provider can provide.
   */
  static tokenTypes: string[] = [ 'type' ];

  /**
   * The token modifiers that this provider supports.
   */
  static tokenModifier: string[] = [ 'defaultLibrary' ];

  /**
   * The legend of the semantic tokens.
   */
  static legend: SemanticTokensLegend = new SemanticTokensLegend(
    GYPSupport.tokenTypes,
    GYPSupport.tokenModifier);

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
   * The constructor.
   */
  constructor() {
    super({ initMethod: '#init' });
    this.#parser = new Parser();
  }

  /**
   * Initialize the provider.
   */
  async ['#init']() {
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

  /**
   * Provide the semantic tokens for the given document.
   * @param document The document to provide semantic tokens for.
   * @return {ProviderResult<SemanticTokens>} The semantic tokens for the given document.
   */
  provideDocumentSemanticTokens(
    document: TextDocument,
  ): ProviderResult<SemanticTokens> {
    const builder = new SemanticTokensBuilder(GYPSupport.legend);

    const tree = this.#parser.parse(document.getText());
    console.log(tree);

    return builder.build();
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
  await Parser.init();

  const gyp = new GYPSupport();
  await gyp.ready();

  context.subscriptions.push(
    languages.registerDocumentSemanticTokensProvider(
      GYPSupport.documentSelector,
      gyp,
      GYPSupport.legend));
}
