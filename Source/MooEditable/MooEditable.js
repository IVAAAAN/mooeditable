/*
Script: MooEditable.js
	Class for creating a WYSIWYG editor, for contentEditable-capable browsers.

License:
	MIT-style license.

Copyright:
	Copyright (c) 2007-2009 [Lim Chee Aun](http://cheeaun.com).
	
Build: %build%

Credits:
	- Code inspired by Stefan's work [Safari Supports Content Editing!](http://www.xs4all.nl/~hhijdra/stefan/ContentEditable.html) from [safari gets contentEditable](http://walkah.net/blog/walkah/safari-gets-contenteditable)
	- Main reference from Peter-Paul Koch's [execCommand compatibility](http://www.quirksmode.org/dom/execCommand.html)
	- Some ideas and code inspired by [TinyMCE](http://tinymce.moxiecode.com/)
	- Some functions inspired by Inviz's [Most tiny wysiwyg you ever seen](http://forum.mootools.net/viewtopic.php?id=746), [mooWyg (Most tiny WYSIWYG 2.0)](http://forum.mootools.net/viewtopic.php?id=5740)
	- Some regex from Cameron Adams's [widgEditor](http://widgeditor.googlecode.com/)
	- Some code from Juan M Martinez's [jwysiwyg](http://jwysiwyg.googlecode.com/)
	- Some reference from MoxieForge's [PunyMCE](http://punymce.googlecode.com/)
	- IE support referring Robert Bredlau's [Rich Text Editing](http://www.rbredlau.com/drupal/node/6)
	- Tango icons from the [Tango Desktop Project](http://tango.freedesktop.org/)
	- Additional Tango icons from Jimmacs' [Tango OpenOffice](http://www.gnome-look.org/content/show.php/Tango+OpenOffice?content=54799)
*/

var MooEditable = new Class({

	Implements: [Events, Options],

	options: {
		toolbar: true,
		cleanup: true,
		paragraphise: true,
		xhtml : true,
		semantics : true,
		actions: 'bold italic underline strikethrough | insertunorderedlist insertorderedlist indent outdent | undo redo | createlink unlink | urlimage | toggleview',
		handleSubmit: true,
		handleLabel: true,
		baseCSS: 'html{ height: 100%; cursor: text }\
			body{ font-family: sans-serif; border: 0; }',
		extraCSS: '',
		externalCSS: '',
		html: '<html>\
			<head>\
			<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\
			<style>{BASECSS} {EXTRACSS}</style>\
			{EXTERNALCSS}\
			</head>\
			<body>{CONTENT}</body>\
			</html>'
	},

	initialize: function(el, options){
		this.setOptions(options);
		this.textarea = $(el);
		this.textarea.store('MooEditable', this);
		this.actions = this.options.actions.clean().split(' ');
		this.keys = {};
		this.dialogs = {};
		this.actions.each(function(action){
			var act = MooEditable.Actions[action];
			if (!act) return;
			if (act.options){
				var key = act.options.shortcut;
				if (key) this.keys[key] = action;
			}
			if(act.dialogs) this.dialogs[action] = act.dialogs;
		}.bind(this));
		this.render();
	},
	
	toElement: function(){
		return this.textarea;
	},
	
	render: function(){
		var self = this;
		
		// Styles and dimensions
		var textareaStyles = this.textarea.getStyles('border-width', 'border-color', 'border-style', 'margin', 'padding');
		var borderWidths = textareaStyles['border-width'].split(' ').map(function(b){ return (b == 'auto') ? 0 : b.toInt(); });
		var paddings = textareaStyles['padding'].split(' ').map(function(p){ return (p == 'auto') ? 0 : p.toInt(); })
		var dimensions = {
			width: this.textarea.getSize().x - borderWidths[1] - borderWidths[3],
			height: this.textarea.getSize().y - borderWidths[0] - borderWidths[2]
		};
		
		// Build the container
		this.container = new Element('div', {
			id: (this.textarea.id) ? this.textarea.id + '-container' : null,
			'class': 'mooeditable-container',
			styles: {
				width: dimensions.width,
				margin: textareaStyles.margin,
				'border-width': textareaStyles['border-width'],
				'border-color': textareaStyles['border-color'],
				'border-style': textareaStyles['border-style']
			}
		});

		// Override all textarea styles
		this.textarea.setStyles({
			margin: 0,
			border: 0,
			padding: 0,
			width: '100%',
			height: dimensions.height,
			resize: 'none', // disable resizable textareas in Safari
			outline: 'none' // disable focus ring in Safari
		});
		
		// Build the iframe
		this.iframe = new IFrame({
			'class': 'mooeditable-iframe',
			styles: {
				height: dimensions.height
			}
		});
		
		this.toolbar = new MooEditable.UI.Toolbar({
			'class': 'mooeditable-toolbar',
			onItemAction: function(){
				var args = $splat(arguments);
				var item = args[0];
				self.action(item.name, Array.slice(args, 1));
			}
		});
		this.attach();
		
		// Update the event for textarea's corresponding labels
		if (this.options.handleLabel && this.textarea.id) $$('label[for="'+this.textarea.id+'"]').addEvent('click', function(e){
			if (self.mode != 'iframe') return;
			e.stop();
			self.focus();
		});

		// Update & cleanup content before submit
		if (this.options.handleSubmit){
			this.form = this.textarea.getParent('form');
			if (!this.form) return;
			this.form.addEvent('submit', function(){
				if (self.mode == 'iframe') self.saveContent();
			});
		}
		
		this.fireEvent('render', this);
	},

	attach: function(){
		var self = this;

		// Assign view mode
		this.mode = 'iframe';

		// Put textarea inside container
		this.container.wraps(this.textarea);

		this.textarea.setStyle('display', 'none');
		
		this.iframe.setStyle('display', '').inject(this.textarea, 'before');
		
		$each(this.dialogs, function(action, name){
			$each(action, function(dialog){
				$(dialog).inject(self.iframe, 'before');
				var range;
				var stop = function(e){ e.stop(); };
				dialog.addEvents({
					open: function(){
						range = self.selection.getRange();
						self.doc.addEvents({
							mousedown: stop,
							keydown: stop
						});
						self.toolbar.disable(name);
					},
					close: function(){
						self.toolbar.enable();
						self.doc.removeEvents({
							mousedown: stop,
							keydown: stop
						});
						self.selection.setRange(range);
					}
				});
			});
		});

		// contentWindow and document references
		this.win = this.iframe.contentWindow;
		this.doc = this.win.document;

		// Build the content of iframe
		var docHTML = this.options.html.substitute({
			BASECSS: this.options.baseCSS,
			EXTRACSS: this.options.extraCSS,
			EXTERNALCSS: (this.options.externalCSS) ? '<link rel="stylesheet" href="' + this.options.externalCSS + '">': '',
			CONTENT: this.cleanup(this.textarea.get('value'))
		});
		this.doc.open();
		this.doc.write(docHTML);
		this.doc.close();

		// Turn on Design Mode
		// IE fired load event twice if designMode is set
		(Browser.Engine.trident) ? this.doc.body.contentEditable = true : this.doc.designMode = 'On';

		// Mootoolize window, document and body
		if (!this.win.$family) new Window(this.win);
		if (!this.doc.$family) new Document(this.doc);
		$(this.doc.body);

		// Bind keyboard shortcuts
		this.doc.addEvents({
			keypress: this.keyListener.bind(this),
			keydown: this.enterListener.bind(this)
		});
		this.textarea.addEvent('keypress', this.textarea.retrieve('mooeditable:textareaKeyListener', this.keyListener.bind(this)));

		// styleWithCSS, not supported in IE and Opera
		if (!['trident', 'presto'].contains(Browser.Engine.name)){
			var styleCSS = function(){
				self.execute('styleWithCSS', false, false);
				self.doc.removeEvent('focus', styleCSS);
			};
			this.doc.addEvent('focus', styleCSS);
		}

		// make images selectable and draggable in Safari
		if (Browser.Engine.webkit) this.doc.addEvent('click', function(e){
			var el = e.target;
			if (el.get('tag') == 'img') self.selectNode(el);
		});

		if (this.options.toolbar){
			$(this.toolbar).inject(this.container, 'top');
			this.toolbar.render(this.actions);
			this.doc.addEvents({
				keyup: this.checkStates.bind(this),
				mouseup: this.checkStates.bind(this)
			});
		}

		this.selection = new MooEditable.Selection(this.win);
		
		this.fireEvent('attach', this);
		
		this.focus();
		
		return this;
	},
	
	detach: function(){
		this.saveContent();
		this.textarea.setStyle('display', '').inject(this.container, 'before');
		this.textarea.removeEvent('keypress', this.textarea.retrieve('mooeditable:textareaKeyListener'));
		this.container.destroy();
		this.fireEvent('detach', this);
		return this;
	},

	keyListener: function(e){
		if (!e.control || !this.keys[e.key]) return;
		var item = this.toolbar.getItem(this.keys[e.key]);
		item.action(e);
	},

	enterListener: function(e){
		if (e.key != 'enter') return;
		if (this.options.paragraphise && !e.shift){
			if (Browser.Engine.gecko || Browser.Engine.webkit){
				var node = this.selection.getNode();
				var blockEls = /^(H[1-6]|P|DIV|ADDRESS|PRE|FORM|TABLE|LI|OL|UL|TD|CAPTION|BLOCKQUOTE|CENTER|DL|DT|DD)$/;
				var isBlock = node.getParents().include(node).some(function(el){
					return el.nodeName.test(blockEls);
				});
				if (!isBlock) this.execute('insertparagraph');
			}
		} else {
			if (Browser.Engine.trident){
				var r = this.selection.getRange();
				var node = this.selection.getNode();
				if (node.get('tag') != 'li'){
					if (r){
						this.selection.insertContent('<br>');
						this.selection.collapse(false);
					}
				}
				e.stop();
			}
		}
	},

	focus: function(){
		// needs the delay to get focus working
		(function(){ 
			(this.mode == 'iframe' ? this.win : this.textarea).focus();
			this.fireEvent('focus', this);
		}).bind(this).delay(10);
		return this;
	},

	action: function(command, args){
		var action = MooEditable.Actions[command];
		if (action.command && $type(action.command) == 'function'){
			action.command.attempt(args, this);
		} else {
			this.focus();
			this.execute(command, false, args);
			if (this.mode == 'iframe') this.checkStates();
		}
	},

	execute: function(command, param1, param2){
		if (this.busy) return;
		this.busy = true;
		this.doc.execCommand(command, param1, param2);
		this.saveContent();
		this.busy = false;
		return false;
	},

	toggleView: function(){
		this.fireEvent('beforeToggleView', this);
		if (this.mode == 'textarea'){
			this.mode = 'iframe';
			this.iframe.setStyle('display', '');
			this.setContent(this.textarea.value);
			this.textarea.setStyle('display', 'none');
		} else {
			this.saveContent();
			this.mode = 'textarea';
			this.textarea.setStyle('display', '');
			this.iframe.setStyle('display', 'none');
		}
		this.fireEvent('toggleView', this);
		this.focus();
		return this;
	},

	getContent: function(){
		return this.cleanup(this.doc.body.get('html'));
	},

	setContent: function(newContent){
		this.doc.body.set('html', newContent);
		return this;
	},

	saveContent: function(){
		if (this.mode == 'iframe') this.textarea.set('value', this.getContent());
		return this;
	},

	checkStates: function(){
		this.actions.each(function(action){
			var item = this.toolbar.getItem(action);
			if (!item) return;
			item.deactivate();

			var states = MooEditable.Actions[action]['states'];
			if (!states) return;
			
			var el = this.selection.getNode();
			if (!el) return;
			
			// custom checkState
			if ($type(states) == 'function'){
				states.attempt(el, item);
				return;
			}
			
			if (states.tags){
				do {
					if ($type(el) != 'element') break;
					var tag = el.tagName.toLowerCase();
					if (states.tags.contains(tag)){
						item.activate(tag);
						break;
					}
				}
				while (el = el.parentNode);
			}

			if (states.css){
				var blockEls = /^(H[1-6]|P|DIV|ADDRESS|PRE|FORM|TABLE|LI|OL|UL|TD|CAPTION|BLOCKQUOTE|CENTER|DL|DT|DD)$/;
				do {
					if ($type(el) != 'element') break;
					var found = false;
					for (var prop in states.css){
						var css = states.css[prop];
						if ($(el).getStyle(prop).contains(css)){
							item.activate(css);
							found = true;
						}
					}
					if (found || el.tagName.test(blockEls)) break;
				}
				while (el = el.parentNode);
			}
		}.bind(this));
	},

	cleanup: function(source){
		if (!this.options.cleanup) return source.trim();
		
		do {
			var oSource = source;

			// Webkit cleanup
			source = source.replace(/<br class\="webkit-block-placeholder">/gi, "<br />");
			source = source.replace(/<span class="Apple-style-span">(.*)<\/span>/gi, '$1');
			source = source.replace(/ class="Apple-style-span"/gi, '');
			source = source.replace(/<span style="">/gi, '');

			// Remove padded paragraphs
			source = source.replace(/<p>\s*<br ?\/?>\s*<\/p>/gi, '<p>\u00a0</p>');
			source = source.replace(/<p>(&nbsp;|\s)*<\/p>/gi, '<p>\u00a0</p>');
			if (!this.options.semantics){
				source = source.replace(/\s*<br ?\/?>\s*<\/p>/gi, '</p>');
			}

			// Replace improper BRs (only if XHTML : true)
			if (this.options.xhtml){
				source = source.replace(/<br>/gi, "<br />");
			}

			if (this.options.semantics){
				//remove divs from <li>
				if (Browser.Engine.trident){
					source = source.replace(/<li>\s*<div>(.+?)<\/div><\/li>/g, '<li>$1</li>');
				}
				//remove stupid apple divs
				if (Browser.Engine.webkit){
					source = source.replace(/^([\w\s]+.*?)<div>/i, '<p>$1</p><div>');
					source = source.replace(/<div>(.+?)<\/div>/ig, '<p>$1</p>');
				}

				//<p> tags around a list will get moved to after the list
				if (['gecko', 'presto', 'webkit'].contains(Browser.Engine.name)){
					//not working properly in safari?
					source = source.replace(/<p>[\s\n]*(<(?:ul|ol)>.*?<\/(?:ul|ol)>)(.*?)<\/p>/ig, '$1<p>$2</p>');
					source = source.replace(/<\/(ol|ul)>\s*(?!<(?:p|ol|ul|img).*?>)((?:<[^>]*>)?\w.*)$/g, '</$1><p>$2</p>');
				}

				source = source.replace(/<br[^>]*><\/p>/g, '</p>');			//remove <br>'s that end a paragraph here.
				source = source.replace(/<p>\s*(<img[^>]+>)\s*<\/p>/ig, '$1\n'); 	//if a <p> only contains <img>, remove the <p> tags

				//format the source
				source = source.replace(/<p([^>]*)>(.*?)<\/p>(?!\n)/g, '<p$1>$2</p>\n');  	//break after paragraphs
				source = source.replace(/<\/(ul|ol|p)>(?!\n)/g, '</$1>\n'); 			//break after </p></ol></ul> tags
				source = source.replace(/><li>/g, '>\n\t<li>'); 				//break and indent <li>
				source = source.replace(/([^\n])<\/(ol|ul)>/g, '$1\n</$2>');  			//break before </ol></ul> tags
				source = source.replace(/([^\n])<img/ig, '$1\n<img'); 				//move images to their own line
				source = source.replace(/^\s*$/g, '');						//delete empty lines in the source code (not working in opera)
			}

			// Remove leading and trailing BRs
			source = source.replace(/<br ?\/?>$/gi, '');
			source = source.replace(/^<br ?\/?>/gi, '');

			// Remove useless BRs
			source = source.replace(/><br ?\/?>/gi, '>');

			// Remove BRs right before the end of blocks
			source = source.replace(/<br ?\/?>\s*<\/(h1|h2|h3|h4|h5|h6|li|p)/gi, '</$1');

			// Semantic conversion
			source = source.replace(/<span style="font-weight: bold;">(.*)<\/span>/gi, '<strong>$1</strong>');
			source = source.replace(/<span style="font-style: italic;">(.*)<\/span>/gi, '<em>$1</em>');
			source = source.replace(/<b\b[^>]*>(.*?)<\/b[^>]*>/gi, '<strong>$1</strong>');
			source = source.replace(/<i\b[^>]*>(.*?)<\/i[^>]*>/gi, '<em>$1</em>');
			source = source.replace(/<u\b[^>]*>(.*?)<\/u[^>]*>/gi, '<span style="text-decoration: underline;">$1</span>');

			// Replace uppercase element names with lowercase
			source = source.replace(/<[^> ]*/g, function(match){return match.toLowerCase();});

			// Replace uppercase attribute names with lowercase
			source = source.replace(/<[^>]*>/g, function(match){
				   match = match.replace(/ [^=]+=/g, function(match2){return match2.toLowerCase();});
				   return match;
			});

			// Put quotes around unquoted attributes
			source = source.replace(/<[^>]*>/g, function(match){
				   match = match.replace(/( [^=]+=)([^"][^ >]*)/g, "$1\"$2\"");
				   return match;
			});

			//make img tags xhtml compatable
			//           if (this.options.xhtml){
			//                source = source.replace(/(<(?:img|input)[^/>]*)>/g, '$1 />');
			//           }

			//remove double <p> tags and empty <p> tags
			source = source.replace(/<p>(?:\s*)<p>/g, '<p>');
			source = source.replace(/<\/p>\s*<\/p>/g, '</p>');
			source = source.replace(/<p>\W*<\/p>/g, '');

			// Final trim
			source = source.trim();
		}
		while (source != oSource);

		return source;
	}

});

MooEditable.Selection = new Class({

	initialize: function(win){
		this.win = win;
	},

	getSelection: function(){
		this.win.focus();
		return (this.win.getSelection) ? this.win.getSelection() : this.win.document.selection;
	},

	getRange: function(){
		var s = this.getSelection();

		if (!s) return null;

		try {
			return s.rangeCount > 0 ? s.getRangeAt(0) : (s.createRange ? s.createRange() : null);
		} catch(e) {
			// IE bug when used in frameset
			return this.doc.body.createTextRange();
		}
	},

	setRange: function(range){
		if (range.select){
			$try(function(){
				range.select();
			});
		} else {
			var s = this.getSelection();
			if (s.addRange){
				s.removeAllRanges();
				s.addRange(range);
			}
		}
	},

	selectNode: function(node, collapse){
		var r = this.getRange();
		var s = this.getSelection();

		if (r.moveToElementText){
			$try(function(){
				r.moveToElementText(node);
				r.select();
			});
		} else if (s.addRange){
			collapse ? r.selectNodeContents(node) : r.selectNode(node);
			s.removeAllRanges();
			s.addRange(r);
		} else {
			s.setBaseAndExtent(node, 0, node, 1);
		}

		return node;
	},

	isCollapsed: function(){
		var r = this.getRange();
		if (r.item) return false;
		return r.boundingWidth == 0 || this.getSelection().isCollapsed;
	},

	collapse: function(toStart){
		var r = this.getRange();
		var s = this.getSelection();

		if (r.select){
			r.collapse(toStart);
			r.select();
		} else {
			toStart ? s.collapseToStart() : s.collapseToEnd();
		}
	},

	getContent: function(){
		var r = this.getRange();
		var body = new Element('body');

		if (this.isCollapsed()) return '';

		if (r.cloneContents){
			body.appendChild(r.cloneContents());
		} else if ($defined(r.item) || $defined(r.htmlText)){
			body.set('html', r.item ? r.item(0).outerHTML : r.htmlText);
		} else {
			body.set('html', r.toString());
		}

		var content = body.get('html');
		return content;
	},

	getText : function(){
		var r = this.getRange();
		var s = this.getSelection();

		return this.isCollapsed() ? '' : r.text || s.toString();
	},

	getNode: function(){
		var r = this.getRange();

		if (!Browser.Engine.trident){
			var el = null;

			if (r){
				el = r.commonAncestorContainer;

				// Handle selection a image or other control like element such as anchors
				if (!r.collapsed)
					if (r.startContainer == r.endContainer)
						if (r.startOffset - r.endOffset < 2)
							if (r.startContainer.hasChildNodes())
								el = r.startContainer.childNodes[r.startOffset];

				while ($type(el) != 'element') el = el.parentNode;
			}

			return $(el);
		}

		return $(r.item ? r.item(0) : r.parentElement());
	},

	insertContent: function(content){
		var r = this.getRange();

		if (r.insertNode){
			r.deleteContents();
			r.insertNode(r.createContextualFragment(content));
		} else {
			// Handle text and control range
			(r.pasteHTML) ? r.pasteHTML(content) : r.item(0).outerHTML = content;
		}
	}

});

MooEditable.UI = {};

MooEditable.UI.Toolbar= new Class({

	Implements: [Events, Options],

	options: {
		/*
		onItemAction: $empty,
		*/
		'class': ''
	},

	initialize: function(options){
		this.setOptions(options);
		this.el = new Element('div', {'class': options['class']});
		this.items = {};
		this.content = null;
	},
	
	toElement: function(){
		return this.el;
	},
	
	render: function(actions){
		if (this.content){
			this.el.adopt(this.content);
		} else {
			this.content = actions.map(function(action){
				return (action == '|') ? this.addSeparator() : this.addItem(action);
			}.bind(this));
		}
		return this;
	},
	
	addItem: function(action){
		var self = this;
		var act = MooEditable.Actions[action];
		if (!act) return;
		var type = act.type || 'button';
		var options = act.options || {};
		var item = new MooEditable.UI[type.camelCase().capitalize()]($extend(options, {
			name: action,
			'class': action + '-item toolbar-' + type + ' toolbar-item',
			title: act.title,
			onAction: self.itemAction.bind(self)
		}));
		this.items[action] = item;
		$(item).inject(this.el);
		return item;
	},
	
	getItem: function(action){
		return this.items[action];
	},
	
	addSeparator: function(){
		return new Element('span', {'class': 'toolbar-separator'}).inject(this.el);
	},
	
	itemAction: function(){
		this.fireEvent('itemAction', arguments);
	},

	disable: function(except){
		$each(this.items, function(item){
			(item.name == except) ? item.activate() : item.deactivate().disable();
		});
		return this;
	},

	enable: function(){
		$each(this.items, function(item){
			item.enable();
		});
		return this;
	},
	
	show: function(){
		this.el.setStyle('display', '');
		return this;
	},
	
	hide: function(){
		this.el.setStyle('display', 'none');
		return this;
	}
	
});

MooEditable.UI.Button = new Class({

	Implements: [Events, Options],

	options: {
		/*
		onAction: $empty,
		*/
		title: '',
		name: '',
		text: 'Button',
		'class': '',
		shortcut: ''
	},

	initialize: function(options){
		this.setOptions(options);
		this.name = this.options.name;
		this.render();
	},
	
	toElement: function(){
		return this.el;
	},
	
	render: function(){
		var self = this;
		var shortcut = (this.options.shortcut) ? ' ( Ctrl+' + this.options.shortcut.toUpperCase() + ' )' : '';
		var text = this.options.title || name;
		var title = text + shortcut;
		this.el = new Element('button', {
			'class': self.options['class'],
			title: title,
			text: text,
			events: {
				click: self.action.bind(self),
				mousedown: function(e){ e.stop(); }
			}
		});
		
		this.disabled = false;

		// add hover effect for IE
		if (Browser.Engine.trident) this.el.addEvents({
			mouseenter: function(e){ this.addClass('hover'); },
			mouseleave: function(e){ this.removeClass('hover'); }
		});
		
		return this;
	},
	
	action: function(e){
		e.stop();
		if (this.disabled) return;
		this.fireEvent('action', this);
	},
	
	enable: function(){
		if (!this.disabled) return;
		this.disabled = false;
		this.el.removeClass('disabled').set('opacity', 1);
		return this;
	},
	
	disable: function(){
		if (this.disabled) return;
		this.disabled = true;
		this.el.addClass('disabled').set('opacity', 0.4);
		return this;
	},
	
	activate: function(){
		if (this.disabled) return;
		this.el.addClass('onActive');
		return this;
	},
	
	deactivate: function(){
		this.el.removeClass('onActive');
		return this;
	}
	
});

MooEditable.UI.Dialog = new Class({

	Implements: [Events, Options],

	options:{
		/*
		onOpen: $empty,
		onClose: $empty,
		*/
		'class': '',
		contentClass: 'dialog-content'
	},

	initialize: function(html, options){
		this.setOptions(options);
		this.html = html;
		
		var self = this;
		this.el = new Element('div', {
			'class': self.options['class'],
			html: '<div class="' + self.options.contentClass + '">' + html + '</div>',
			styles: {
				'display': 'none'
			},
			events: {
				click: self.click.bind(self)
			}
		});
	},
	
	toElement: function(){
		return this.el;
	},
	
	click: function(){
		this.fireEvent('click', arguments);
		return this;
	},
	
	open: function(){
		this.el.setStyle('display', '');
		this.fireEvent('open', this);
		return this;
	},
	
	close: function(){
		this.el.setStyle('display', 'none');
		this.fireEvent('close', this);
		return this;
	}

});

MooEditable.UI.AlertDialog = function(alertText){
	var html = alertText + ' <button class="dialog-ok-button">OK</button>';
	return dialog = new MooEditable.UI.Dialog(html, {
		'class': 'alert-dialog mooeditable-dialog'
	}).addEvents({
		open: function(){
			var button = this.el.getElement('.dialog-ok-button');
			(function(){
				button.focus();
			}).delay(10);
		},
		click: function(e){
			e.stop();
			if (e.target.tagName.toLowerCase() != 'button') return;
			if ($(e.target).hasClass('dialog-ok-button')) this.close();
		}
	});
};

MooEditable.UI.PromptDialog = function(questionText, answerText){
	var html = '<label class="mooeditable-dialog-label">' + questionText
		+ ' <input type="text" class="text mooeditable-dialog-input" value="' + answerText + '">'
		+ '</label> <button class="dialog-ok-button">OK</button>'
		+ '<button class="dialog-cancel-button">Cancel</button>';
	return new MooEditable.UI.Dialog(html, {
		'class': 'prompt-dialog mooeditable-dialog'
	}).addEvents({
		open: function(){
			var input = this.el.getElement('.mooeditable-dialog-input');
			(function(){
				input.focus()
				input.select();
			}).delay(10);
		},
		click: function(e){
			e.stop();
			if (e.target.tagName.toLowerCase() != 'button') return;
			var button = $(e.target);
			var input = this.el.getElement('.mooeditable-dialog-input');
			if (button.hasClass('dialog-cancel-button')){
				input.set('value', answerText);
				this.close();
			} else if (button.hasClass('dialog-ok-button')){
				var answer = input.get('value');
				input.set('value', answerText);
				this.close();
				this.fireEvent('clickOK', answer);
			}
		},
	});
};

MooEditable.Actions = new Hash({

	bold: {
		title: 'Bold',
		options: {
			shortcut: 'b'
		},
		states: {
			tags: ['b', 'strong'],
			css: {'font-weight': 'bold'}
		}
	},
	
	italic: {
		title: 'Italic',
		options: {
			shortcut: 'i'
		},
		states: {
			tags: ['i', 'em'],
			css: {'font-style': 'italic'}
		}
	},
	
	underline: {
		title: 'Underline',
		options: {
			shortcut: 'u'
		},
		states: {
			tags: ['u'],
			css: {'text-decoration': 'underline'}
		}
	},
	
	strikethrough: {
		title: 'Strikethrough',
		options: {
			shortcut: 's'
		},
		states: {
			tags: ['s', 'strike'],
			css: {'text-decoration': 'line-through'}
		}
	},
	
	insertunorderedlist: {
		title: 'Unordered List',
		states: {
			tags: ['ul']
		}
	},
	
	insertorderedlist: {
		title: 'Ordered List',
		states: {
			tags: ['ol']
		}
	},
	
	indent: {
		title: 'Indent',
		states: {
			tags: ['blockquote']
		}
	},
	
	outdent: {
		title: 'Outdent'
	},
	
	undo: {
		title: 'Undo',
		options: {
			shortcut: 'z'
		}
	},
	
	redo: {
		title: 'Redo',
		options: {
			shortcut: 'y'
		}
	},
	
	unlink: {
		title: 'Remove Hyperlink'
	},

	createlink: {
		title: 'Add Hyperlink',
		options: {
			shortcut: 'l'
		},
		states: {
			tags: ['a']
		},
		dialogs: {
			alert: MooEditable.UI.AlertDialog('Please select the text you wish to hyperlink.'),
			prompt: MooEditable.UI.PromptDialog('Enter URL', 'http://')
		},
		command: function(){
			if (this.selection.isCollapsed()){
				this.dialogs.createlink.alert.open();
			} else {
				var text = this.selection.getText();
				var url = /^(https?|ftp|rmtp|mms):\/\/(([A-Z0-9][A-Z0-9_-]*)(\.[A-Z0-9][A-Z0-9_-]*)+)(:(\d+))?\/?/i;
				this.dialogs.createlink.prompt.addEvents({
					open: function(){
						if (url.test(text)) this.el.getElement('.mooeditable-dialog-input').set('value', text);
					},
					clickOK: function(url){
						this.execute('createlink', false, url.trim());
					}
				}).open();
			}
		}
	},

	urlimage: {
		title: 'Add Image',
		options: {
			shortcut: 'm'
		},
		dialogs: {
			prompt: MooEditable.UI.PromptDialog('Enter image URL', 'http://')
		},
		command: function(){
			this.dialogs.urlimage.prompt.addEvent('clickOK', function(url){
				this.execute("insertimage", false, url.trim());
			}.bind(this)).open();
		}
	},

	toggleview: {
		title: 'Toggle View',
		command: function(){
			(this.mode == 'textarea') ? this.toolbar.enable() : this.toolbar.disable('toggleview');
			this.toggleView();
		}
	}

});

Element.Properties.mooeditable = {

	set: function(options){
		return this.eliminate('mooeditable').store('mooeditable:options', options);
	},

	get: function(options){
		if (options || !this.retrieve('mooeditable')){
			if (options || !this.retrieve('mooeditable:options')) this.set('mooeditable', options);
			this.store('mooeditable', new MooEditable(this, this.retrieve('mooeditable:options')));
		}
		return this.retrieve('mooeditable');
	}

};

Element.implement({

	mooEditable: function(options){
		return this.get('mooeditable', options);
	}

});