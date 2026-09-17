#!/usr/bin/env node
'use strict';

const { run } = require('../lib/router.js');

run(process.argv.slice(2));
