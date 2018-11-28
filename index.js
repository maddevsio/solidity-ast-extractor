#!/usr/bin/env node

const solc = require('solc');
const antlr = require('solidity-parser-antlr');
const fs = require('fs');
const https = require('https');
const MemoryStream = require('memorystream');
const argv = require('yargs')
  .usage('Usage: $0 -f input_file [options]')
  .example('$0 -f file.sol -o output.json', 'extract sol details')
  .alias('f', 'file')
  .nargs('f', 1)
  .describe('f', 'Load a file')
  .demandOption(['f'])
  .option('output', {
    alias: 'o',
    describe: 'Output json file',
    type: 'json',
  })
  .showHelpOnFail(false, 'Specify --help for available options')
  .help()
  .argv
;


function extractPragmaVersion(data) {
  const compilers = data.filter(opt => opt.type === 'PragmaDirective');
  
  if (compilers && compilers.length > 0) {
    const rawVersion = compilers[0].value;
    return rawVersion.replace(/[^0-9.]/g, '');
  }
  return null;
}

function isSameCompiler(pragmaVersion, solcVersion) {
  return solcVersion.startsWith(pragmaVersion);
}


function extractContractNames(data) {
  return data
    .filter(opt => opt.type === 'ContractDefinition' && opt.kind === 'contract')
    .map(contract => contract.name)
  ;
}


function compile(pragmaVersion, solfile, cb) {
  if (!pragmaVersion || isSameCompiler(pragmaVersion, solc.semver())) {
    const compiled = solc.compile(solfile);
    return cb(null, compiled);
  }

  listRemoteCompilers(function(err, data) {
    if (err) {
      return cb(err);
    }
    const dataAsString = data.toString();
    const dataAsObject = JSON.parse(dataAsString);
    const { releases } = dataAsObject;
    const compilerFile = releases[pragmaVersion] || releases.latestRelease;
    const cleanedVersion = compilerFile.replace(/(^soljson-)|(\.js$)/g, '');
    solc.loadRemoteVersion(cleanedVersion, function(err, remoteSolc) {
      if (err) {
        return cb(err);
      }
      const compiled = remoteSolc.compile(solfile);
      return cb(null, compiled);
    });
  });
}

function listRemoteCompilers(cb) {
  const memomry = new MemoryStream(null, { readable: false });

  https.get('https://ethereum.github.io/solc-bin/bin/list.json', function (response) {
    if (response.statusCode !== 200) {
      return cb(new Error('Could not fetch compiler list.'));
    }

    response.pipe(memomry);
    response.on('end', function () {
      cb(null, memomry);
    });
  });
}


function run(inputFile, outputFile) {
   
  fs.readFile(inputFile, 'utf-8', function(err, solfile) {
    if (err) {
      process.stdout.write(`Solidity file "${inputFile}" not found or could not be read.`);
      return process.exit(1);
    }
    let antlrParsed
    try {
      antlrParsed = antlr.parse(solfile);
    } catch(err) {
      process.stdout.write(`Unable to parse solidity file.`);
      return process.exit(1);
    }
    
    const compilerVersion = extractPragmaVersion(antlrParsed.children);
    const contracts = extractContractNames(antlrParsed.children);
    
    compile(compilerVersion, solfile, function(err, compiledSolFile) {
      if (err) {
        process.stdout.write(err);
        return process.exit(1);
      }
      
      const result = JSON.stringify({
        compilerVersion,
        contracts,
        AST: compiledSolFile.sources[''].AST
      }, null, 2);

      if (outputFile) {
        fs.writeFile(outputFile, result, err => {
          if (err) {
            process.stdout.write(`Could not write output to "${outputFile}".`);
            return process.exit(1);
          }
          process.stdout.write(`Output has been save in ${outputFile}`);
        })
      } else {
        process.stdout.write(result);
      }
    });
  });
}


run(argv.f, argv.o);
