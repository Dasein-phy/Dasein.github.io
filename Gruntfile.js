module.exports = function (grunt) {
  const OUTPUT_BASENAME = 'hux-blog'; // 与主题文件名保持一致，不改 head.html 也能直接用

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    uglify: {
      main: {
        src: 'js/' + OUTPUT_BASENAME + '.js',
        dest: 'js/' + OUTPUT_BASENAME + '.min.js'
      }
    },

    less: {
      expanded: {
        options: { paths: ['css'] },
        files: (function () {
          const out = {};
          out['css/' + OUTPUT_BASENAME + '.css'] = 'less/' + OUTPUT_BASENAME + '.less';
          return out;
        })()
      },
      minified: {
        options: { paths: ['css'], cleancss: true },
        files: (function () {
          const out = {};
          out['css/' + OUTPUT_BASENAME + '.min.css'] = 'less/' + OUTPUT_BASENAME + '.less';
          return out;
        })()
      }
    },

    banner:
      '/*!\n' +
      ' * <%= pkg.title %> v<%= pkg.version %> (<%= pkg.homepage %>)\n' +
      ' * Copyright <%= grunt.template.today("yyyy") %> <%= pkg.author %>\n' +
      ' */\n',

    usebanner: {
      dist: {
        options: { position: 'top', banner: '<%= banner %>' },
        files: {
          src: [
            'css/' + OUTPUT_BASENAME + '.css',
            'css/' + OUTPUT_BASENAME + '.min.css',
            'js/' + OUTPUT_BASENAME + '.min.js'
          ]
        }
      }
    },

    watch: {
      scripts: {
        files: ['js/' + OUTPUT_BASENAME + '.js'],
        tasks: ['uglify', 'usebanner'],
        options: { spawn: false }
      },
      less: {
        files: ['less/*.less'],
        tasks: ['less', 'usebanner'],
        options: { spawn: false }
      }
    }
  });

  // Plugins
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-less');
  grunt.loadNpmTasks('grunt-banner');
  grunt.loadNpmTasks('grunt-contrib-watch');

  // Default
  grunt.registerTask('default', ['uglify', 'less', 'usebanner']);
};
