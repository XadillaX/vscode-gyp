UPDATE_GRAMMAR_BIN = ./node_modules/.bin/update-grammar

.PHONY: update_grammar pack

update-grammar:
	$(UPDATE_GRAMMAR_BIN) MagicStack/MagicPython grammars/MagicPython.tmLanguage syntaxes/MagicPython.tmLanguage.json
	$(UPDATE_GRAMMAR_BIN) MagicStack/MagicPython grammars/MagicRegExp.tmLanguage syntaxes/MagicRegExp.tmLanguage.json

pack:
	npm install
	npm run compile
	rm -rf node_modules
	npm install --prod
