require "rubygems"
require "rake"
require "yaml"
require "time"

SOURCE = "."
CONFIG = {
  "version" => "12.3.2",
  "themes"  => File.join(SOURCE, "_includes", "themes"),
  "layouts" => File.join(SOURCE, "_layouts"),
  "posts"   => File.join(SOURCE, "_posts"),
  "post_ext"=> "md",
  "theme_package_version" => "0.1.0"
}

# 用法：
#   rake post title="标题" subtitle="副标题" [date="2025-08-15"] [author="署名"] [header="/img/custom.jpg"]
desc "Begin a new post in #{CONFIG['posts']}"
task :post do
  abort("rake aborted: '#{CONFIG['posts']}' directory not found.") unless FileTest.directory?(CONFIG["posts"])

  title    = ENV["title"]    || "new-post"
  subtitle = ENV["subtitle"] || "副标题"
  author   = ENV["author"]   || "Dasein"
  header   = ENV["header"]   || "/img/home-bg.jpg"

  # 生成 slug（允许中文标题回退）
  slug = title.downcase.strip.gsub(/\s+/, "-").gsub(/[^\w\-]/, "")
  slug = "post" if slug.nil? || slug.empty?

  begin
    date = (ENV["date"] ? Time.parse(ENV["date"]) : Time.now).strftime("%Y-%m-%d")
  rescue Exception
    puts "Error - date format must be YYYY-MM-DD, please check you typed it correctly!"
    exit(-1)
  end

  filename = File.join(CONFIG["posts"], "#{date}-#{slug}.#{CONFIG["post_ext"]}")
  if File.exist?(filename)
    # 若你的环境没有定义 ask 方法，默认覆盖（也可手动删除旧文件）
    if respond_to?(:ask)
      abort("rake aborted!") if ask("#{filename} already exists. Overwrite?", %w[y n]) == "n"
    end
  end

  puts "Creating new post: #{filename}"
  File.open(filename, "w") do |post|
    post.puts "---"
    post.puts "layout: post"
    post.puts "title: \"#{title.gsub(/-/, ' ')}\""
    post.puts "subtitle: \"#{subtitle.gsub(/-/, ' ')}\""
    post.puts "date: #{date}"
    post.puts "author: \"#{author}\""
    post.puts "header-img: \"#{header}\""
    post.puts "tags: []"
    post.puts "---"
    post.puts
    post.puts "<!-- 正文从此处开始 -->"
  end
end

desc "Launch preview environment"
task :preview do
  # 需要本地安装 bundler & jekyll
  system "bundle exec jekyll serve --livereload"
end

# Load custom rake scripts
Dir["_rake/*.rake"].each { |r| load r }
