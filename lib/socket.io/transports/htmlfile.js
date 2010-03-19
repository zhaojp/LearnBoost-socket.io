var Client = require('../client').Client, 
	qs = require('querystring');

this['htmlfile'] = Client.extend({
	
	_onConnect: function(req, res){
		switch (req.method){
			case 'GET':
				var self = this;
				this.__super__(req, res);							
				this.request.addListener('end', function(){
					if (!('hijack' in self.connection)){
						throw new Error('You have to patch Node! Please refer to the README');
					}
				
					self.connection.addListener('end', function(){ self._onClose(); });								
					self.connection.hijack();
					self.connection.setTimeout(0);
				});
				
				this.response.writeHead(200, { 'Content-type': 'text/html' });
				this.response.flush();
				
				this._payload();
				break;
				
			case 'POST':
				req.addListener('data', function(message){
					try {
						var msg = qs.parse(message);
						self._onMessage(msg.data);
					} catch(e){}			
					res.writeHead(200);
					res.write('ok');
					res.close();
				});
				break;
		}
	},
	
	_write: function(message){
		// not sure if this is enough escaping. looks lousy
		this.response.write("<script>parent.callback('"+ message.replace(/'/, "\'") +"')</script>");
	}
	
});