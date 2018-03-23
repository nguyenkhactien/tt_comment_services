module.exports = {
	create: function (req, res) {
		var response = {
			status:  0,
			message: [],
			data:    [{}]
		}
		var fields = {};

		if(req.method != "POST") {
			response.message.push("Bad request. Return 400 !");
			return res.json(400, response);
		}
		var nid = req.validate({"nid": "numeric"}, false);
		if(!nid) {
			response.message.push("Newsid dosenot exist. Ignore request");
			return res.json(400, response);
		}
		var params = req.validate([
			{"uid": "numeric"}, 
			{"uname": "string"},
			{"reply_to?": "int"},
			{"promoted?": "int"},
			{"ip": "ip"},
			{"content": "string"}
		], false);
		if(!params) {
			response.message.push("Invalid params. Ignore request");
			return res.json(400, response)
		}

		var validParamsCase = new Promise(function (resolve, reject) {
			if(!params.uid || !params.uname) {
				return reject(1);
			} else {
				fields.uid = params.uid;
				fields.uname = params.uname;
			}

			if(!params.promoted) {
				fields.promoted = 0;
			} else {
				fields.promoted = parseInt(params.promoted);
			}
			if(!params.reply_to) {
				fields.reply_to = 0;
				resolve(1);
			}
			else {
				Comment_new.findOne({
					cid: parseInt(params.reply_to)
				}).then(function (parrentComment) {
					if(typeof parrentComment != 'undefined') {
						fields.reply_to = parrentComment.cid;
						resolve(1);
					}
					else {
						reject("Undefined comment");
					}
				}).catch(function (err) {
					throw err;
				});
			}
		});

		validParamsCase.then(function (validParams) {
			// Insert to comment new
			return new Promise(function (resolve, reject) {
				fields.created = Math.floor((new Date()).getTime() / 1000);
				fields.changed = Math.floor((new Date()).getTime() / 1000);
				fields.content = params.content;
				fields.status = 1;
				fields.host = params.ip.split('.').reduce(function(ipInt, octet) {
					return (ipInt<<8) + parseInt(octet, 10)
				}, 0);
				Comment_new.create(fields).then(function (result) {
					resolve(result);
				}).catch(function (err) {
					reject(err);
				});
			});
		}).then(function (createdComment) {
			// Insert to comment cache
			var newCommentCache_Fields = {
				lastest: []
			};

			var dataCreatedComment = { //init form(like old form) and data
				cid: createdComment.cid,
				uid: createdComment.uid,
				uname: createdComment.uname,
				content: createdComment.content,
				created: createdComment.created,
				changed: createdComment.changed,
				status: (createdComment.status == 1) ? true : false,
				promoted: false,
				replyTo: parseInt(createdComment.reply_to),
				host: createdComment.host,
				guid: 0,
				__isset_bit_vector: [1, 1, 1, 1, 1, 1, 1, 1],
				optionals: ["CID"]
			}
			
			return new Promise(function (resolve, reject) {
				if(createdComment.reply_to == 0) {
					// If it is newly comment then no comment reply to it
					newCommentCache_Fields.guid    = createdComment.cid;
					newCommentCache_Fields.count   = 0;
					newCommentCache_Fields.lastest.push(dataCreatedComment);
					newCommentCache_Fields.lastest = JSON.stringify(newCommentCache_Fields.lastest);
					
					Comment_cache.create(newCommentCache_Fields).then(function (result) {
						response.message.push("Comment id " + createdComment.cid + " was added by " + createdComment.uname);
						response.data[0].comment_id = createdComment.cid;
						response.data[0].user       = createdComment.uid + "__" + createdComment.uname;
						response.data[0].content    = createdComment.content;
						resolve(result);
					}).catch(function (err) {
						reject(err);
					});
				}
				else {
					Comment_cache.findOne({guid: createdComment.reply_to}).then(function (existCache) {
						if(typeof existCache != "undefined") {
							newCommentCache_Fields.count = parseInt(existCache.count) + 1;

							var lastestCache = JSON.parse(existCache.lastest);
							if(lastestCache.length < 3) {
								lastestCache.push(dataCreatedComment);
								newCommentCache_Fields.lastest = JSON.stringify(lastestCache);
							} 
							else if(lastestCache.length == 3) {
								lastestCache.splice(1,1);
								lastestCache.push(dataCreatedComment);
								newCommentCache_Fields.lastest = JSON.stringify(lastestCache);
							}

							Comment_cache.update({guid: createdComment.reply_to}, newCommentCache_Fields).then(function (dataCreatedComment) {	
								response.message.push("Comment id " + createdComment.cid + " added by " + createdComment.uname);
								response.data[0].comment_id = createdComment.cid;
								response.data[0].user = createdComment.uid + "__" + createdComment.uname;
								response.data[0].content = createdComment.content;
								resolve(dataCreatedComment);
							}).catch(function (err) {
								reject("Update comment's content failed");
							});
						} else {
							reject("Undefined cache comment");
						}
					}).catch(function (err) {
						reject("Comment not found");
					});
				}
			});
		}).then(function (createdCommentCache) {
			// Resulting for created cache
			console.log(createdCommentCache);
			response.status = 1;
			response.message.push("Cache was changed");
			response.data[0].commentcache_id = createdCommentCache.guid;
			response.data[0].commentcache_latest = createdCommentCache.lastest;
			return res.json(response);
		}).catch(function (err) {
			response.message.push(err);
			return res.json(response);
		});
	},
	update: function (req, res) {
		var response = {
			status:  0,
			message: [],
			data:    [{}]
		}
		var fields = {};

		if(req.method != "POST") {
			response.message.push("Bad request. Return 400 !");
			return res.json(400, response);
		}

		// params: cid, new content, uid
		var comment = req.validate({"cid": "numeric"}, false);
		if(!comment) {
			response.message = "Comment is required!";
			return res.json(400, response);
		}

		var params = req.validate([
			{"content": "string"}, 
			{"uid": "numeric"}
		], false);
		if(!params) {
			response.message = "Invalid params";
			return res.json(400, response);
		}

		var promiseUpdateComment = new Promise(function (resolve, reject) {
			Comment_new.findOne({
				cid: comment.cid,
				uid: params.uid
			}).then(function (foundComment) {
				if(typeof foundComment != "undefined") {
					let newFields = {};
					newFields.changed = Math.floor((new Date()).getTime()/1000);
					newFields.content = params.content;

					Comment_new.update({cid: comment.cid}, newFields).then(function (wasUpdated) {
						resolve(wasUpdated);
					}).catch(function (err) {
						reject("Update comment's content failed");
					});
				}
				else {
					reject("Undefined comment");
				}
			}).catch(function (err) {
				reject("Comment not found");
			});
		});
		promiseUpdateComment.then(function (wasUpdated) {
			response.message.push("Comment " + wasUpdated[0].cid + " was updated !");
			response.data[0].cid = wasUpdated[0].cid;
			response.data[0].new_cotent = wasUpdated[0].content;
			response.data[0].time = wasUpdated[0].changed;
			response.status = 1;

			return new Promise(function (resolve, reject) {
				var reply_to = parseInt(wasUpdated[0].reply_to);
				if(reply_to == 0) {
					// It is main comment.
					// Find comment_cache by cid not reply_to(cid = guid)
					let comment_id = parseInt(wasUpdated[0].cid);
					Comment_cache.findOne({
						guid: comment_id
					}).then(function (foundCache) {
						if(typeof foundCache != "undefined") {
							let lastestContent = JSON.parse(foundCache.lastest);
							lastestContent[0].content = wasUpdated[0].content;
							lastestContent[0].changed = wasUpdated[0].changed;

							Comment_cache.update({guid: comment_id}, {lastest: JSON.stringify(lastestContent)}).then(function (successful) {
								resolve(successful);
							}).catch(function (err) {
								reject("Update cache's lastest failed");
							});
						} else {
							reject("Undefined comment cache");
						}
					}).catch(function (err) {
						reject("Comment cache not found");
					});
				}
				else {
					// reply_to = guid
					let reply_to = parseInt(wasUpdated[0].reply_to);
					Comment_cache.findOne({
						guid: reply_to
					}).then(function (foundCache) {
						if(typeof foundCache != "undefined") {
							let lastestContent = JSON.parse(foundCache.lastest);
							lastestContent.forEach(function (eachOne) {
								if(eachOne.cid == wasUpdated[0].cid) {
									eachOne.changed = wasUpdated[0].changed;
									eachOne.content = wasUpdated[0].content;
								}
							});
							Comment_cache.update({guid: reply_to}, {lastest: JSON.stringify(lastestContent)}).then(function (successful) {
								resolve(successful);
							}).catch(function (err) {
								reject("Update cache's lastest failed");
							});
						}
						else {
							reject("Undefined comment cache");
						}
					}).catch(function (err) {
						reject("Comment cache not found");
					});
				}
			});
		}).then(function (wasUpdatedCache) {
			response.message.push("Comment Cache " + wasUpdatedCache[0].guid + " was updated !");
			response.data[0].comment_cache = wasUpdatedCache[0].guid;
			response.data[0].new_cache = wasUpdatedCache[0].lastest;
			return res.json(response);
		}).catch(function (err) {
			response.message.push(err);
			return res.json(response);
		});
	},
	test: function (req, res) {
		Comment_new.findOne({
			cid: 4200,
			uid: 10583827
		}).exec(function (err, result) {
			if(err) throw err;
			console.log(result);
		})
	}
};

